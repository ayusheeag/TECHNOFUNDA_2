"""Live provider layer — fetches that aren't in the nightly snapshot: news
(Polygon), annual+quarterly financials (Polygon, real diluted EPS), long daily
history (FMP, ~5y), and intraday bars (Polygon, delayed). Everything is TTL-
cached in-process so a stock-detail view doesn't re-hit the providers."""
from __future__ import annotations

import csv
import io
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.providers import polygon as pg  # noqa: E402
from src.providers.base import get_json  # noqa: E402

FMP_EOD = "https://financialmodelingprep.com/stable/historical-price-eod/full"

# ---- tiny TTL cache --------------------------------------------------------
_cache: dict[str, tuple[float, object]] = {}


def _cached(key: str, ttl: float, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    val = fn()
    _cache[key] = (now + ttl, val)
    return val


def _fmp_key() -> str:
    k = os.getenv("FMP_API_KEY")
    if not k:
        raise RuntimeError("FMP_API_KEY not set")
    return k


# ---- daily / weekly (FMP, long history) ------------------------------------
def fetch_daily(symbol: str, years: int = 5) -> pd.DataFrame:
    """~`years` of daily OHLCV from FMP, oldest→newest. Columns: date, open,
    high, low, close, volume (date = 'YYYY-MM-DD')."""
    def go() -> pd.DataFrame:
        start = (datetime.now(timezone.utc) - timedelta(days=int(years * 365.5))).strftime("%Y-%m-%d")
        end = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = get_json(FMP_EOD, {"symbol": symbol.upper(), "from": start, "to": end, "apikey": _fmp_key()})
        rows = r if isinstance(r, list) else (r.get("historical", []) if isinstance(r, dict) else [])
        if not rows:
            return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume"])
        df = pd.DataFrame(rows)[["date", "open", "high", "low", "close", "volume"]].copy()
        df["date"] = df["date"].astype(str)
        return df.sort_values("date").reset_index(drop=True)

    return _cached(f"daily:{symbol}:{years}", 900, go)  # prices refresh every 15 min


def resample_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Daily → weekly (week-ending Friday) OHLCV."""
    if df.empty:
        return df
    d = df.copy()
    d["dt"] = pd.to_datetime(d["date"])
    d = d.set_index("dt")
    w = d.resample("W-FRI").agg(open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last"), volume=("volume", "sum")).dropna(subset=["close"])
    w = w.reset_index()
    w["date"] = w["dt"].dt.strftime("%Y-%m-%d")
    return w[["date", "open", "high", "low", "close", "volume"]]


# ---- intraday (Polygon, delayed) -------------------------------------------
_TF = {
    "15m": (15, "minute", 20),  # (multiplier, timespan, lookback_days)
    "1h": (1, "hour", 60),
    "4h": (4, "hour", 180),
}


def fetch_intraday(symbol: str, tf: str) -> pd.DataFrame:
    """Intraday OHLCV from Polygon. `date` column is a UNIX-SECONDS int (what
    lightweight-charts needs for intraday time)."""
    mult, span, lookback = _TF[tf]

    def go() -> pd.DataFrame:
        start = (datetime.now(timezone.utc) - timedelta(days=lookback)).strftime("%Y-%m-%d")
        end = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        url = f"https://api.polygon.io/v2/aggs/ticker/{symbol.upper()}/range/{mult}/{span}/{start}/{end}"
        r = get_json(url, {"adjusted": "true", "sort": "asc", "limit": 50000, "apikey": os.getenv("POLYGON_API_KEY")})
        res = r.get("results", []) if isinstance(r, dict) else []
        if not res:
            return pd.DataFrame(columns=["date", "open", "high", "low", "close", "volume"])
        return pd.DataFrame([{
            "date": int(b["t"] // 1000),  # ms → s
            "open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b.get("v", 0),
        } for b in res])

    return _cached(f"intra:{symbol}:{tf}", 300, go)


def fetch_bars(symbol: str, tf: str) -> tuple[pd.DataFrame, bool]:
    """Return (bars_df, is_daily_like). Daily/weekly get full stage/RS; intraday
    is candles-only."""
    if tf in ("15m", "1h", "4h"):
        return fetch_intraday(symbol, tf), False
    daily = fetch_daily(symbol, years=5)
    if tf == "1w":
        return resample_weekly(daily), True
    return daily, True


# ---- news (Polygon, insight sentiment) -------------------------------------
def _sentiment(article: dict, symbol: str) -> str:
    for ins in article.get("insights") or []:
        if (ins.get("ticker") or "").upper() == symbol.upper():
            s = (ins.get("sentiment") or "").lower()
            return "pos" if s == "positive" else "neg" if s == "negative" else "neutral"
    title = (article.get("title") or "").lower()
    if any(w in title for w in ("beat", "surge", "record", "upgrade", "raises", "soar", "jump")):
        return "pos"
    if any(w in title for w in ("miss", "plunge", "cut", "downgrade", "falls", "drop", "lawsuit", "probe")):
        return "neg"
    return "neutral"


def fetch_news(symbol: str, limit: int = 10) -> list[dict]:
    def go() -> list[dict]:
        arts = pg.news(symbol, limit=limit)
        out = []
        for a in arts:
            pub = a.get("publisher") or {}
            senti = _sentiment(a, symbol)
            insights = a.get("insights") or []
            reasoning = next((i.get("sentiment_reasoning") for i in insights if (i.get("ticker") or "").upper() == symbol.upper() and i.get("sentiment_reasoning")), None)
            out.append({
                "id": str(a.get("id") or a.get("article_url")),
                "symbol": symbol.upper(),
                "date": (a.get("published_utc") or "")[:10],
                "title": a.get("title") or "",
                "source": pub.get("name") or "News",
                "url": a.get("article_url") or "#",
                "sentiment": senti,
                "summary": reasoning or (a.get("description") or "")[:180] or "No summary available.",
            })
        return out

    return _cached(f"news:{symbol}:{limit}", 900, go)  # news refreshes every 15 min


# ---- financials (Polygon, real EPS) — annual + quarterly -------------------
def _yoy(cur, prev):
    if cur is None or prev is None or prev <= 0:
        return None
    return round((cur / prev - 1) * 100, 1)


def _q_num(report_date: str) -> int:
    m = int(report_date[5:7]) if len(report_date) >= 7 else 1
    return (m - 1) // 3 + 1


def _fin_rows(symbol: str, timeframe: str) -> list[dict]:
    """Clean financial rows, oldest→newest. Polygon leaves revenue holes for
    some filers, so we drop any period with no revenue (it would otherwise show
    as a phantom $0), and compute YoY against the SAME period one year earlier —
    keyed by (year, quarter), not a positional offset — so gaps don't misalign
    the comparison."""
    r = pg.financials(symbol, timeframe=timeframe, limit=14)
    parsed = [pg.parse_financials(x) for x in (r.get("results", []) if isinstance(r, dict) else [])]
    parsed = [p for p in parsed if p.get("report_date") and p.get("revenue") is not None]
    parsed.sort(key=lambda p: p["report_date"])  # oldest → newest

    def yq(p: dict) -> tuple[int, int]:
        y = int((p.get("report_date") or "0")[:4])
        return (y, 1 if timeframe == "annual" else _q_num(p["report_date"]))

    by_key = {yq(p): p for p in parsed}
    rows = []
    for p in parsed:
        y, q = yq(p)
        prev = by_key.get((y - 1, q))
        rev, eps, gp = p.get("revenue"), p.get("eps"), p.get("gross_profit")
        rows.append({
            "period": _period_label(p, timeframe),
            "reportDate": p["report_date"],
            "revenue": rev,
            "revenueYoY": _yoy(rev, prev.get("revenue")) if prev else None,
            "eps": round(eps, 2) if eps is not None else None,
            "epsYoY": _yoy(eps, prev.get("eps")) if prev else None,
            "grossMargin": round(gp / rev * 100, 1) if (gp is not None and rev) else None,
            "fcf": p.get("op_cash_flow"),
        })
    return rows


def _period_label(p: dict, timeframe: str) -> str:
    fy = p.get("fiscal_year") or (p.get("report_date") or "")[:4]
    if timeframe == "annual":
        return f"FY{fy}"
    rd = p.get("report_date") or ""
    m = int(rd[5:7]) if len(rd) >= 7 else 1
    q = (m - 1) // 3 + 1
    return f"Q{q} {rd[:4]}"


def fetch_financials(symbol: str) -> dict:
    def go() -> dict:
        annual = _fin_rows(symbol, "annual")[-6:]
        quarterly = _fin_rows(symbol, "quarterly")[-8:]
        return {"annual": annual, "quarterly": quarterly}

    return _cached(f"fin:{symbol}", 86400, go)


# ---- earnings calendar (Alpha Vantage — full market, one call/day) ----------
_TIME = {"pre-market": "bmo", "post-market": "amc"}


def fetch_earnings_calendar() -> list[dict]:
    """The whole US earnings calendar (~3 months forward) from Alpha Vantage, as
    [{symbol, name, date, epsEstimate, time}]. Cached 6h so one call serves all
    requests (the CSV covers thousands of names)."""
    def go() -> list[dict]:
        av = os.getenv("ALPHAVANTAGE_API_KEY")
        if not av:
            return []
        url = f"https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={av}"
        with urllib.request.urlopen(url, timeout=30) as resp:
            text = resp.read().decode("utf-8", "replace")
        if "symbol" not in text[:80].lower():  # rate-limit / info message, not CSV
            return []
        out = []
        for r in csv.DictReader(io.StringIO(text)):
            est = (r.get("estimate") or "").strip()
            out.append({
                "symbol": (r.get("symbol") or "").strip(),
                "name": (r.get("name") or "").strip(),
                "date": (r.get("reportDate") or "").strip(),
                "epsEstimate": float(est) if est and est.replace("-", "").replace(".", "").isdigit() else None,
                "time": _TIME.get((r.get("timeOfTheDay") or "").strip().lower(), "unknown"),
            })
        return [x for x in out if x["symbol"] and x["date"]]

    return _cached("earncal", 6 * 3600, go)

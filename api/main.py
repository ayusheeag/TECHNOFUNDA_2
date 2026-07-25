"""TechnoFunda API — FastAPI wrapping the existing Python analysis + snapshot
tables, serving the exact camelCase contract the web realProvider fetches.
Snapshot-first (reads the nightly-refreshed tables); the stock chart is computed
live from daily_bars. Run:  DB_PATH=data/screener_prod.db uvicorn api.main:app"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from functools import lru_cache

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import chart as chartmod
from . import composite as comp
from . import interpret as I
from . import live
from .dbio import clean_str, read_df, title_case
from src.analysis.stage import stage_snapshot
from src.db import database as db


def _clean(o):
    """Recursively make a payload strict-JSON safe: NaN/Inf → null, numpy → py."""
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.generic):
        v = o.item()
        return None if (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) else v
    if isinstance(o, (pd.Timestamp,)):
        return str(o)
    return o


class SafeJSON(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(_clean(content), ensure_ascii=False, allow_nan=False).encode("utf-8")


app = FastAPI(title="TechnoFunda API", version="1.0.0", default_response_class=SafeJSON)
# CORS origins:
#  • CORS_ORIGINS  — exact allowed origins, comma-separated (e.g. a custom domain
#    "https://app.technofunda.com"). No trailing slash.
#  • CORS_ORIGIN_REGEX — overrides the default match. The default already allows
#    any localhost port AND any *.vercel.app deploy (production + every preview),
#    so a Vercel-hosted web works with NO extra config.
_cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
_cors_regex = os.getenv("CORS_ORIGIN_REGEX", r"https?://localhost:\d+|https://[a-z0-9-]+\.vercel\.app")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)

BENCH = "SPY"


# ---- small helpers ---------------------------------------------------------
def nn(x):
    """NaN/NA → None (JSON-safe); numpy scalar → python."""
    if x is None:
        return None
    if isinstance(x, (np.floating, float)) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, np.generic):
        return x.item()
    return x


def market_phase(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    # crude ET offset (no DST table); metadata only, never feeds a series
    et_hour = (now.hour - 4) % 24
    wd = now.weekday()
    if wd >= 5:
        return "WEEKEND"
    mins = et_hour * 60 + now.minute
    if mins < 4 * 60:
        return "CLOSED"
    if mins < 9 * 60 + 30:
        return "PREMARKET"
    if mins < 16 * 60:
        return "RTH"
    if mins < 20 * 60:
        return "POSTMARKET"
    return "CLOSED"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- cached lookup frames (static per process; DB is nightly) --------------
@lru_cache(maxsize=1)
def _tickers() -> pd.DataFrame:
    return read_df("SELECT symbol, name, sector, industry, market_cap FROM tickers")


@lru_cache(maxsize=1)
def _technicals() -> pd.DataFrame:
    return read_df("SELECT symbol, name, sector, industry, ibd50, close, rsi14, above_ema_long, above_ema_mid, at_52w_high, stage, stage_label, rs_line, rs_new_high FROM stock_technicals")


@lru_cache(maxsize=1)
def _rerating() -> pd.DataFrame:
    return read_df("SELECT * FROM rerating_scores")


def _fund_annual(symbol: str) -> pd.DataFrame:
    return read_df("SELECT * FROM fundamentals WHERE symbol=? ORDER BY period", [symbol.upper()])


def _bars_for(symbols) -> pd.DataFrame:
    if not symbols:
        return pd.DataFrame(columns=["symbol", "date", "open", "high", "low", "close", "volume"])
    ph = ",".join("?" * len(symbols))
    return read_df(f"SELECT symbol, date, open, high, low, close, volume FROM daily_bars WHERE symbol IN ({ph})", list(symbols))


def _bench() -> pd.DataFrame:
    return read_df("SELECT date, close FROM daily_bars WHERE symbol=?", [BENCH])


def _net_income_yoy(annual: pd.DataFrame):
    """EPS growth proxy = net-income YoY (split-immune; shares ~constant)."""
    ni = pd.to_numeric(annual.get("net_income"), errors="coerce").tolist() if "net_income" in annual else []
    if len(ni) < 2 or ni[-2] is None or ni[-2] <= 0 or ni[-1] is None:
        return None
    return round((ni[-1] / ni[-2] - 1) * 100, 1)


# ---- ownership / valuation lookups -----------------------------------------
def _ibd50(symbol: str) -> bool:
    t = _technicals()
    r = t[t["symbol"] == symbol.upper()]
    return bool(r["ibd50"].iloc[0]) if len(r) else False


def _rerating_row(symbol: str):
    rr = _rerating()
    r = rr[rr["symbol"] == symbol.upper()]
    return r.iloc[0] if len(r) else None


# ---- endpoints: health + pulse ---------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "time": now_iso()}


def _regime_response() -> dict:
    row = read_df("SELECT * FROM breadth ORDER BY date DESC LIMIT 1")
    if row.empty:
        return {"regime": None, "pctAbove200ema": None, "pctAbove50ema": None, "new52wHighs": 0, "universeSize": 0, "icon": "", "sizingText": "", "interpretation": I.regime_interp(None, 0, 0)}
    r = row.iloc[0]
    regime = r["regime"]
    meta = I.REGIME_META.get(regime, {"glyph": "", "sizing": ""})
    return {
        "regime": regime,
        "pctAbove200ema": nn(r["pct_above_200ema"]),
        "pctAbove50ema": nn(r["pct_above_50ema"]),
        "new52wHighs": int(r["new_52w_highs"]),
        "universeSize": int(r["universe_size"]),
        "icon": meta["glyph"],
        "sizingText": meta["sizing"],
        "interpretation": I.regime_interp(regime, r["pct_above_200ema"], int(r["new_52w_highs"])),
    }


@app.get("/regime")
def regime():
    return _regime_response()


@app.get("/meta")
def meta():
    reg = _regime_response()
    counts = read_df("SELECT (SELECT COUNT(*) FROM tickers) t, (SELECT COUNT(*) FROM daily_bars) b, (SELECT COUNT(*) FROM fundamentals) f").iloc[0]
    rm = read_df("SELECT * FROM refresh_meta LIMIT 1")
    last = rm.iloc[0]["last_run_utc"] if not rm.empty else now_iso()
    return {
        "lastRunISO": last,
        "marketPhase": market_phase(),
        "universeSize": reg["universeSize"],
        "counts": {"tickers": int(counts["t"]), "priceBars": int(counts["b"]), "fundamentals": int(counts["f"])},
        "regime": reg,
        "summary": I.interp(reg["interpretation"]["headline"], reg["interpretation"]["tone"], f"{int(counts['t'])} names tracked · data as of {read_df('SELECT MAX(date) d FROM breadth').iloc[0]['d']}."),
    }


@app.get("/breadth")
def breadth(limit: int = Query(0)):
    df = read_df("SELECT * FROM breadth ORDER BY date")
    if limit and limit < len(df):
        df = df.tail(limit)
    rows = [{
        "date": str(r["date"]),
        "pctAbove200ema": nn(r["pct_above_200ema"]),
        "pctAbove50ema": nn(r["pct_above_50ema"]),
        "new52wHighs": int(r["new_52w_highs"]),
        "new52wLows": int(r["new_52w_lows"]),
        "regime": r["regime"],
    } for _, r in df.iterrows()]
    latest = rows[-1] if rows else None
    pct_spark = [r["pctAbove200ema"] for r in rows]
    nh_spark = [r["new52wHighs"] for r in rows]
    trend = (pct_spark[-1] - pct_spark[0]) if pct_spark else 0
    interp = I.interp(
        f"{latest['pctAbove200ema']:.0f}% of the universe is above its 200-day" if latest else "No breadth data",
        "good" if latest and latest["regime"] == "aggressive" else "bad" if latest and latest["regime"] == "shallow" else "neutral",
        f"{'Breadth improving' if trend >= 0 else 'Breadth deteriorating'} over the window; {latest['new52wHighs']} names at new 52-week highs." if latest else None,
    )
    return {"rows": rows, "latest": latest, "pctSpark": pct_spark, "nhSpark": nh_spark, "interpretation": interp}


def _sector_leaders(sector: str, k=2):
    t = _technicals()
    sub = t[t["sector"] == sector].copy()
    if sub.empty:
        return []
    sub["lead"] = sub["stage"].fillna(0).map({1: 45, 2: 75, 3: 35, 4: 12}).fillna(0) + sub["rs_new_high"].fillna(0) * 12
    return sub.sort_values("lead", ascending=False).head(k)["symbol"].tolist()


@app.get("/sectors")
def sectors():
    df = read_df("SELECT * FROM sector_scores").sort_values("rsi14", ascending=False)
    out = []
    for _, r in df.iterrows():
        above200 = bool(r["above_200ema"])
        rsi = nn(r["rsi14"])
        chip = I.sector_chip(above200, rsi)
        out.append({
            "sector": r["sector"],
            "etf": r["etf"],
            "close": nn(r["close"]),
            "rsi14": rsi,
            "above200ema": above200,
            "above50ema": bool(r["above_50ema"]),
            "pctFrom52wHigh": nn(r["pct_from_52w_high"]),
            "monthsAboveTrend": nn(r["months_above_trend"]) or 0,
            "soundNotStretched": bool(r["sound_not_stretched"]),
            "chip": chip,
            "leaderSymbols": _sector_leaders(r["sector"]),
            "interpretation": I.sector_interp(r["sector"], r["etf"], chip, rsi),
        })
    return out


@app.get("/sectors/industries")
def industries():
    t = _technicals()
    fund = read_df("SELECT symbol, revenue_yoy, period FROM fundamentals")
    fund = fund.sort_values("period").groupby("symbol").tail(1)
    ry = dict(zip(fund["symbol"], fund["revenue_yoy"]))
    out = []
    for (industry, sector), g in t.groupby(["industry", "sector"]):
        revs = [ry.get(s) for s in g["symbol"] if ry.get(s) is not None and not pd.isna(ry.get(s))]
        median = round(float(np.median(revs)), 1) if revs else None
        stage2 = int((g["stage"] == 2).sum())
        breadth_pct = round(stage2 / len(g) * 100)
        out.append({
            "industry": industry,
            "sector": sector,
            "medianRevYoY": median,
            "breadthPctStage2": breadth_pct,
            "interpretation": I.interp(
                f"{industry} — median revenue {I.pct_txt(median)}",
                "good" if median is not None and median >= 20 else "bad" if median is not None and median < 5 else "neutral",
                f"{breadth_pct}% of names in a Stage-2 uptrend.",
            ),
        })
    out.sort(key=lambda x: (x["medianRevYoY"] is None, -(x["medianRevYoY"] or 0)))
    return out


@app.get("/tickers")
def tickers(q: str = "", limit: int = 8):
    t = _tickers()
    qq = q.strip().upper()
    if not qq:
        return []
    sym_prefix = t[t["symbol"].str.upper().str.startswith(qq)]
    name_match = t[t["name"].str.upper().str.contains(qq, regex=False, na=False) & ~t["symbol"].str.upper().str.startswith(qq)]
    hits = pd.concat([sym_prefix, name_match]).head(limit)
    return [{
        "symbol": r["symbol"],
        "name": title_case(r["name"]),
        "sector": r["sector"],
        "marketCap": nn(r["market_cap"]) or 0,
        "label": f"{r['symbol']} · {title_case(r['name'])}",
    } for _, r in hits.iterrows()]


# ---- per-symbol enrichment for list composites -----------------------------
def _snapshot_map(symbols) -> dict:
    """stage/slope/rangePos/aboveMa per symbol via the vectorised stage_snapshot
    (same ladder as the chart, so lists and the detail agree)."""
    bars = _bars_for(symbols)
    if bars.empty:
        return {}
    snap = stage_snapshot(bars)
    m = {}
    for _, r in snap.iterrows():
        m[r["symbol"]] = {
            "stage": None if pd.isna(r["stage"]) else int(r["stage"]),
            "maSlopePct": nn(r["ma_slope_pct"]),
            "rangePos": nn(r["range_pos"]),
            "aboveMa": bool(r["above_ma"]),
        }
    return m


def _spark_map(symbols, n=40) -> dict:
    bars = _bars_for(symbols)
    out = {}
    for sym, g in bars.groupby("symbol"):
        closes = pd.to_numeric(g.sort_values("date")["close"], errors="coerce").tolist()
        out[sym] = {"spark": [round(c, 2) for c in closes[-n:]], "changePct": round((closes[-1] / closes[-2] - 1) * 100, 2) if len(closes) >= 2 else 0.0}
    return out


def _fund_latest_map(symbols) -> dict:
    if not symbols:
        return {}
    ph = ",".join("?" * len(symbols))
    df = read_df(f"SELECT symbol, period, revenue_yoy, net_income FROM fundamentals WHERE symbol IN ({ph}) ORDER BY period", list(symbols))
    out = {}
    for sym, g in df.groupby("symbol"):
        g = g.sort_values("period")
        rev = nn(g["revenue_yoy"].iloc[-1])
        out[sym] = {"revYoY": rev, "epsYoY": _net_income_yoy(g)}
    return out


def _build_screen_rows(base: pd.DataFrame) -> list:
    symbols = base["symbol"].tolist()
    snap = _snapshot_map(symbols)
    spark = _spark_map(symbols)
    fund = _fund_latest_map(symbols)
    rr = _rerating()
    rr_map = {r["symbol"]: r for _, r in rr[rr["symbol"].isin(symbols)].iterrows()}
    tech = _technicals()
    ibd = dict(zip(tech["symbol"], tech["ibd50"]))
    rows = []
    for _, br in base.iterrows():
        sym = br["symbol"]
        s = snap.get(sym, {})
        f = fund.get(sym, {})
        rrr = rr_map.get(sym)
        stage = s.get("stage") if s.get("stage") is not None else (int(br["stage"]) if "stage" in br and not pd.isna(br["stage"]) else None)
        composite = comp.build_composite(
            stage=stage, range_pos=s.get("rangePos"), rs_new_high=bool(br.get("rs_new_high", 0)),
            above_ma=s.get("aboveMa", False), slope_pct=s.get("maSlopePct"),
            rev_yoy=f.get("revYoY"), eps_yoy=f.get("epsYoY"),
            is_ibd50=bool(ibd.get(sym, 0)),
            pe_pctile=nn(rrr["pe_pctile"]) if rrr is not None else None,
            pe_vs_sector=nn(rrr["pe_vs_sector"]) if rrr is not None else None,
        )
        sp = spark.get(sym, {"spark": [], "changePct": 0.0})
        rows.append({
            "symbol": sym, "name": title_case(br.get("name")), "sector": br.get("sector"), "industry": br.get("industry"),
            "close": nn(br.get("close")), "changePct": sp["changePct"],
            "revenueYoY": f.get("revYoY"), "epsYoY": f.get("epsYoY"),
            "debtToEquity": nn(br.get("debt_to_equity")), "currentRatio": nn(br.get("current_ratio")),
            "roe": nn(br.get("roe")), "fcf": nn(br.get("fcf")), "pe": nn(br.get("pe")), "evEbitda": nn(br.get("ev_ebitda")),
            "rsi14": nn(br.get("rsi14")), "rsLine": nn(br.get("rs_line")), "rsNewHigh": bool(br.get("rs_new_high", 0)),
            "at52wHigh": bool(br.get("at_52w_high", 0)), "pctBelowHigh": nn(br.get("pct_below_high")), "stage": stage,
            "score": nn(br.get("score")) or 0,
            "spark": sp["spark"], "composite": composite,
            "interpretation": I.screen_row_interp(composite["verdict"], stage, f.get("revYoY"), bool(br.get("rs_new_high", 0)), composite["interpretation"]["detail"]),
        })
    return rows


@app.get("/screen/default")
def screen_default():
    base = read_df("SELECT * FROM screen_results ORDER BY score DESC")
    return _build_screen_rows(base)


@app.get("/sectors/{sector}/constituents")
def sector_constituents(sector: str):
    base = read_df("SELECT * FROM screen_results WHERE sector=? ORDER BY score DESC", [sector])
    return _build_screen_rows(base)


@app.get("/rerating")
def rerating(only_flagged: bool = Query(False, alias="only_flagged")):
    df = _rerating().copy()
    if only_flagged:
        df = df[df["rerating_setup"] == 1]
    # Flagged setups first, then cheapest by percentile; cap the payload (2k+ rows
    # of "no edge" names aren't useful and bloat the RSC props).
    df = df.sort_values(["rerating_setup", "pe_pctile"], ascending=[False, True]).head(200)
    symbols = df["symbol"].tolist()
    spark = _spark_map(symbols)
    out = []
    for _, r in df.iterrows():
        flagged = bool(r["rerating_setup"])
        out.append({
            "symbol": r["symbol"], "name": title_case(r["name"]), "sector": r["sector"], "industry": r["industry"],
            "peNow": nn(r["pe_now"]), "peMedian": nn(r["pe_median"]), "pePctile": nn(r["pe_pctile"]),
            "sectorPeMedian": nn(r["sector_pe_median"]), "peVsSector": nn(r["pe_vs_sector"]),
            "revGrowthNow": nn(r["rev_growth_now"]), "revGrowthSlope": nn(r["rev_growth_slope"]),
            "flagged": flagged, "spark": spark.get(r["symbol"], {}).get("spark", []),
            "interpretation": I.rerating_interp(flagged, nn(r["pe_pctile"]), nn(r["pe_vs_sector"]), nn(r["rev_growth_now"]), nn(r["rev_growth_slope"])),
        })
    return out


@app.post("/screen")
def run_screen(params: dict):
    min_growth = params.get("minGrowth", 15)
    max_de = params.get("maxDE", 1.0)
    min_cr = params.get("minCurrentRatio", 1.2)
    base = read_df("SELECT * FROM screen_results")
    base = base[(base["revenue_yoy"].fillna(-999) >= min_growth) & (base["debt_to_equity"].fillna(999) <= max_de) & (base["current_ratio"].fillna(0) >= min_cr)]
    inds = params.get("industries")
    if inds:
        base = base[base["industry"].isin(inds)]
    return _build_screen_rows(base.sort_values("score", ascending=False))


# ---- stock detail ----------------------------------------------------------
def _daily_bars(sym: str) -> pd.DataFrame:
    """Daily OHLCV: FMP (~5y) when the key is available, else the DB snapshot
    (~1.5y). Keeps the detail page working even without live-provider keys."""
    try:
        d = live.fetch_daily(sym, years=5)
        if not d.empty:
            return d
    except Exception:
        pass
    db_bars = _bars_for([sym.upper()])
    return db_bars[["date", "open", "high", "low", "close", "volume"]] if not db_bars.empty else db_bars


def _chart_for(symbol: str, tf: str = "1d") -> dict:
    """Chart payload. Daily/weekly prefer FMP (5y) with full stage/RS, falling
    back to the DB; intraday (15m/1h/4h) come from Polygon, candles-only. The
    daily chart is what the composite reads, so chart and composite agree."""
    sym = symbol.upper()
    if tf in ("15m", "1h", "4h"):
        try:
            bars, _ = live.fetch_bars(sym, tf)
        except Exception:
            bars = pd.DataFrame()
        if bars.empty:
            raise HTTPException(404, f"No intraday data for {sym} — set POLYGON_API_KEY, or use the 1D/1W view.")
        return chartmod.compute_intraday(sym, bars, market_phase(), now_iso(), tf)

    daily = _daily_bars(sym)
    if daily.empty:
        raise HTTPException(404, f"No price history for {sym}")
    bench = _daily_bars("SPY")
    if bench.empty:
        bench = _bench()
    if tf == "1w":
        return chartmod.compute(sym, live.resample_weekly(daily), live.resample_weekly(bench), market_phase(), now_iso(), ma_window=30, slope_window=4, range_window=52, timeframe="1w")
    return chartmod.compute(sym, daily, bench, market_phase(), now_iso(), timeframe="1d")


@app.get("/stocks/{symbol}")
def stock_detail(symbol: str, chart: int = 0, tf: str = "1d"):
    symbol = symbol.upper()
    if _tickers()[_tickers()["symbol"] == symbol].empty and _technicals()[_technicals()["symbol"] == symbol].empty:
        raise HTTPException(404, f"We don't track {symbol}")
    if chart:
        return _chart_for(symbol, tf)
    ch = _chart_for(symbol, "1d")  # composite always reads the daily chart
    tk = _tickers()[_tickers()["symbol"] == symbol]
    tech = _technicals()[_technicals()["symbol"] == symbol]
    name = title_case(tk["name"].iloc[0]) if len(tk) else (title_case(tech["name"].iloc[0]) if len(tech) else symbol)
    sector = (tk["sector"].iloc[0] if len(tk) else None) or (tech["sector"].iloc[0] if len(tech) else "—")
    industry = (tk["industry"].iloc[0] if len(tk) else None) or (tech["industry"].iloc[0] if len(tech) else "—")
    mcap = nn(tk["market_cap"].iloc[0]) if len(tk) else 0
    ann = _fund_annual(symbol)
    rev = nn(ann["revenue_yoy"].iloc[-1]) if not ann.empty else None
    eps = _net_income_yoy(ann)
    rrr = _rerating_row(symbol)
    composite = comp.build_composite(
        stage=ch["stage"], range_pos=ch["rangePos"], rs_new_high=ch["rsNewHigh"], above_ma=ch["aboveMa"], slope_pct=ch["maSlopePct"],
        rev_yoy=rev, eps_yoy=eps, is_ibd50=_ibd50(symbol),
        pe_pctile=nn(rrr["pe_pctile"]) if rrr is not None else None,
        pe_vs_sector=nn(rrr["pe_vs_sector"]) if rrr is not None else None,
    )
    ch_bars = ch["bars"]
    change_pct = round((ch_bars[-1]["close"] / ch_bars[-2]["close"] - 1) * 100, 2) if len(ch_bars) >= 2 else 0.0
    return {
        "symbol": symbol, "name": name, "sector": sector, "industry": industry,
        "price": ch["close"], "changePct": change_pct,
        "marketCap": mcap or 0, "stage": ch["stage"], "rsNewHigh": ch["rsNewHigh"],
        "regime": _regime_response()["regime"], "composite": composite, "interpretation": composite["interpretation"],
    }


@app.get("/stocks/{symbol}/stage")
def stock_stage(symbol: str):
    ch = _chart_for(symbol)
    return {k: ch[k] for k in ("symbol", "stage", "label", "action", "close", "ma150", "aboveMa", "maSlopePct", "rangePos", "rsi14", "days", "series", "interpretation", "rsNewHigh")}


@app.get("/stocks/{symbol}/financials")
def financials(symbol: str):
    symbol = symbol.upper()
    try:
        fin = live.fetch_financials(symbol)  # Polygon: real diluted EPS, annual + quarterly
        annual, quarterly = fin["annual"], fin["quarterly"]
    except Exception:
        annual, quarterly = [], []
    if not annual:  # fall back to the annual snapshot if the live fetch is empty
        ann = _fund_annual(symbol)
        annual = [{"period": f"FY{r['period']}", "reportDate": str(r["report_date"]), "revenue": nn(r["revenue"]) or 0,
                   "revenueYoY": nn(r["revenue_yoy"]), "eps": 0.0, "epsYoY": None,
                   "grossMargin": round(nn(r["gross_margin"]) * 100, 1) if nn(r["gross_margin"]) is not None else None,
                   "fcf": nn(r["fcf"])} for _, r in ann.iterrows()]
    rev_latest = annual[-1]["revenueYoY"] if annual else None
    eps_latest = annual[-1]["epsYoY"] if annual else None
    return {"symbol": symbol, "annual": annual, "quarterly": quarterly, "interpretation": I.financials_interp(rev_latest, eps_latest)}


@app.get("/stocks/{symbol}/valuation-history")
def valuation_history(symbol: str):
    ann = _fund_annual(symbol.upper())
    return [{"period": f"FY{r['period']}", "reportDate": str(r["report_date"]), "pe": nn(r["pe"]), "evEbitda": nn(r["ev_ebitda"]), "revenueYoY": nn(r["revenue_yoy"])} for _, r in ann.iterrows()]


@app.get("/stocks/{symbol}/news")
def news(symbol: str, limit: int = 10):
    try:
        return live.fetch_news(symbol, limit=limit)  # Polygon news + insight sentiment
    except Exception:
        return []


# ---- earnings + concall + watchlist ----------------------------------------
@app.get("/earnings")
def earnings(from_: str = Query(None, alias="from"), to: str = Query(None)):
    today = read_df("SELECT MAX(date) d FROM breadth").iloc[0]["d"]
    lo = from_ or today
    hi = to or (pd.Timestamp(today) + pd.Timedelta(days=30)).strftime("%Y-%m-%d")
    tech = _technicals()
    stage_map = dict(zip(tech["symbol"], tech["stage"]))
    name_map = dict(zip(_tickers()["symbol"], _tickers()["name"]))

    def days_until(d: str) -> int:
        return int((pd.Timestamp(d) - pd.Timestamp(today)).days)

    def stage_of(sym: str):
        st = stage_map.get(sym)
        return None if st is None or pd.isna(st) else int(st)

    # Prefer the live full-market calendar (thousands of names); fall back to the DB snapshot.
    cal = []
    try:
        cal = live.fetch_earnings_calendar()
    except Exception:
        cal = []
    if cal:
        rows = []
        for e in cal:
            d = e["date"]
            if d < lo or d > hi:
                continue
            eps = e["epsEstimate"]
            rows.append({
                "symbol": e["symbol"], "name": title_case(name_map.get(e["symbol"]) or e["name"] or e["symbol"]), "date": d,
                "epsEstimate": eps, "time": e["time"], "daysUntil": days_until(d), "stage": stage_of(e["symbol"]),
                "interpretation": I.earnings_interp(days_until(d), e["time"], eps),
            })
        rows.sort(key=lambda r: (r["date"], r["symbol"]))
        return rows[:400]  # cap the payload; nearest dates first

    # DB fallback
    df = read_df("SELECT * FROM earnings_enriched ORDER BY date")
    out = []
    for _, r in df.iterrows():
        d = str(r["date"])
        if d < lo or d > hi:
            continue
        eps = nn(r["eps_consensus"])
        out.append({
            "symbol": r["symbol"], "name": title_case(r["name"]), "date": d,
            "epsEstimate": eps, "time": "unknown", "daysUntil": days_until(d), "stage": stage_of(r["symbol"]),
            "interpretation": I.earnings_interp(days_until(d), "unknown", eps),
        })
    return out


@app.get("/concall/transcripts")
def transcripts(symbol: str = None):
    sql = "SELECT symbol, period, date FROM transcripts"
    params = None
    if symbol:
        sql += " WHERE symbol=?"
        params = [symbol.upper()]
    df = read_df(sql, params)
    return [{"symbol": r["symbol"], "period": r["period"], "date": str(r["date"])} for _, r in df.iterrows()]


@app.get("/concall/{symbol}/{period}")
def concall(symbol: str, period: str):
    df = read_df("SELECT * FROM concall_summaries WHERE symbol=? AND period=?", [symbol.upper(), period])
    if df.empty:
        return None
    r = df.iloc[0]
    return {"symbol": r["symbol"], "period": r["period"], "date": None, "bullets": [], "guidance": I.interp(clean_str(r["digest"]) or "Summary", r["tone"] or "neutral", None), "sentiment": "neutral", "source": "stored", "sourceNote": f"Stored summary ({r['method']})."}


@app.post("/concall/summarize")
def summarize(body: dict):
    text = body.get("text", "")
    pos = any(w in text.lower() for w in ("beat", "record", "raised", "strong", "expand"))
    neg = any(w in text.lower() for w in ("miss", "weak", "cut", "headwind", "pressure"))
    sentiment = "pos" if pos and not neg else "neg" if neg and not pos else "neutral"
    return {"symbol": None, "period": None, "date": None, "bullets": [], "guidance": I.interp("Heuristic read", "good" if sentiment == "pos" else "bad" if sentiment == "neg" else "neutral", f"{len(text)} characters analysed — not investment advice."), "sentiment": sentiment, "source": "generated", "sourceNote": "Generated on demand — heuristic, not investment advice."}


# ---- per-user watchlist (DB-backed, keyed by X-User-Id) --------------------
def _ensure_wl_table():
    with db.connect() as c:
        c.execute("CREATE TABLE IF NOT EXISTS user_watchlist (user_id TEXT, symbol TEXT, added_at TEXT, PRIMARY KEY (user_id, symbol))")
        c.commit()


_ensure_wl_table()


def _uid(x_user_id: str | None) -> str:
    # Client sends a stable anonymous id (localStorage) until real auth; then it
    # becomes the authenticated user id. Never trust it for anything but scoping.
    return (x_user_id or "anon")[:64]


def _watch_symbols(uid: str) -> list[str]:
    df = read_df("SELECT symbol FROM user_watchlist WHERE user_id=? ORDER BY added_at DESC", [uid])
    return df["symbol"].tolist() if not df.empty else []


def _compose_watch_item(symbol: str) -> dict:
    d = stock_detail(symbol, chart=0)  # daily chart + composite
    ch = _chart_for(symbol, "1d")
    spark = [round(p["close"], 2) for p in ch["series"][-40:]]
    earn = read_df("SELECT * FROM earnings_enriched WHERE symbol=? ORDER BY date LIMIT 1", [symbol.upper()])
    next_earnings = None
    if not earn.empty:
        r = earn.iloc[0]
        today = read_df("SELECT MAX(date) d FROM breadth").iloc[0]["d"]
        days = int((pd.Timestamp(str(r["date"])) - pd.Timestamp(today)).days)
        eps = nn(r["eps_consensus"])
        next_earnings = {"symbol": symbol.upper(), "name": title_case(r["name"]), "date": str(r["date"]), "epsEstimate": eps, "time": "unknown", "daysUntil": days, "stage": d["stage"], "interpretation": I.earnings_interp(days, "unknown", eps)}
    verdict = d["composite"]["verdict"]
    interp = I.interp(
        {"act": "Setup lines up", "avoid": "Weak — consider dropping", "watch": "Mixed — keep watching"}[verdict],
        {"act": "good", "avoid": "bad", "watch": "warn"}[verdict],
        (f"Reports in {next_earnings['daysUntil']} days — the near-term catalyst." if next_earnings and next_earnings["daysUntil"] <= 7 else (f"Next earnings {next_earnings['daysUntil']} days out." if next_earnings else "No upcoming earnings scheduled.")),
    )
    return {"symbol": symbol.upper(), "name": d["name"], "stage": d["stage"], "verdict": verdict, "nextEarnings": next_earnings,
            "changePct": d["changePct"], "close": d["price"], "spark": spark, "interpretation": interp}


@app.get("/watchlist")
def get_watchlist(x_user_id: str | None = Header(default=None)):
    uid = _uid(x_user_id)
    items = []
    for sym in _watch_symbols(uid):
        try:
            items.append(_compose_watch_item(sym))
        except Exception:
            continue
    return items


@app.post("/watchlist")
def add_watchlist(body: dict, x_user_id: str | None = Header(default=None)):
    uid = _uid(x_user_id)
    symbol = str(body.get("symbol", "")).upper()
    if not symbol:
        raise HTTPException(400, "symbol required")
    with db.connect() as c:
        if db.IS_PG:
            c.execute("INSERT INTO user_watchlist (user_id, symbol, added_at) VALUES (?,?,?) ON CONFLICT (user_id, symbol) DO NOTHING", [uid, symbol, now_iso()])
        else:
            c.execute("INSERT OR IGNORE INTO user_watchlist (user_id, symbol, added_at) VALUES (?,?,?)", [uid, symbol, now_iso()])
        c.commit()
    return _compose_watch_item(symbol)


@app.delete("/watchlist/{symbol}", status_code=204)
def remove_watchlist(symbol: str, x_user_id: str | None = Header(default=None)):
    uid = _uid(x_user_id)
    with db.connect() as c:
        c.execute("DELETE FROM user_watchlist WHERE user_id=? AND symbol=?", [uid, symbol.upper()])
        c.commit()
    return None

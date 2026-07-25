"""Ingest ticker universe + fundamentals from FMP (stable API) into SQLite.

Free-tier path:
  - universe is built from per-symbol PROFILES (sector/industry/market cap),
    because the bulk screener/stock-list endpoints are paid.
  - fundamentals use ANNUAL statements (quarterly ratios are paid), so YoY
    revenue growth is year-over-year.

Paid users can call ingest_universe_via_screener() for a bulk universe.
"""
from __future__ import annotations

import time

from src.db import database as db
from src.providers import fmp
from src.providers.base import RestrictedError


def _pick(d: dict, *keys):
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return None


# --- Universe -------------------------------------------------------------

def ingest_universe_from_symbols(symbols: list[str], *, throttle: float = 0.0,
                                 include_funds: bool = False) -> int:
    """Free-tier universe: fetch a profile per symbol for classification.

    ETFs/funds are skipped by default (they have no sector/industry the screen
    can use), unless include_funds=True.
    """
    rows = []
    for sym in symbols:
        sym = sym.strip().upper()
        if not sym:
            continue
        try:
            data = fmp.profile(sym)
        except Exception as e:
            print(f"  {sym}: profile failed ({e})")
            continue
        if not data:
            continue
        p = data[0]
        if not include_funds and (p.get("isEtf") or p.get("isFund")):
            continue
        rows.append({
            "symbol": p.get("symbol", sym),
            "name": p.get("companyName"),
            "exchange": p.get("exchange"),
            "sector": p.get("sector"),
            "industry": p.get("industry"),
            "market_cap": p.get("marketCap"),
            "is_active": 1 if p.get("isActivelyTrading", True) else 0,
            "updated_at": db.now_iso(),
        })
        if throttle:
            time.sleep(throttle)
    with db.connect() as conn:
        n = db.upsert(conn, "tickers", rows)
        db.log_ingest(conn, "universe_profiles", f"n={len(symbols)}", n)
    print(f"universe: {n} tickers classified")
    return n


def ingest_universe_via_screener(min_market_cap: float = 1e9,
                                 exchanges=("NASDAQ", "NYSE", "AMEX")) -> int:
    """PAID path: bulk universe via the company screener."""
    rows = []
    for ex in exchanges:
        for r in fmp.company_screener(marketCapMoreThan=min_market_cap, exchange=ex,
                                      isActivelyTrading="true", limit=10000):
            rows.append({
                "symbol": r.get("symbol"),
                "name": r.get("companyName"),
                "exchange": r.get("exchangeShortName") or ex,
                "sector": r.get("sector"),
                "industry": r.get("industry"),
                "market_cap": r.get("marketCap"),
                "is_active": 1,
                "updated_at": db.now_iso(),
            })
    with db.connect() as conn:
        n = db.upsert(conn, "tickers", rows)
        db.log_ingest(conn, "universe", "screener", n)
    print(f"universe: {n} tickers")
    return n


# --- Fundamentals ---------------------------------------------------------

def ingest_fundamentals(symbol: str, period: str = "annual", limit: int = 5) -> int:
    """Pull income statement + ratios + key metrics, merge, compute YoY growth.

    Uses annual data by default (free-tier friendly). Field names target the
    FMP /stable/ schema.
    """
    symbol = symbol.upper()
    try:
        inc = {r["date"]: r for r in fmp.income_statement(symbol, period=period, limit=limit)}
        rat = {r["date"]: r for r in fmp.ratios(symbol, period=period, limit=limit)}
        met = {r["date"]: r for r in fmp.key_metrics(symbol, period=period, limit=limit)}
    except RestrictedError:
        # Free tier doesn't cover this symbol's fundamentals -- skip, don't crash.
        print(f"  {symbol}: fundamentals not on your plan (skipped)")
        return 0

    dates = sorted(inc.keys(), reverse=True)  # newest first
    rows = []
    for d in dates:
        i, r, m = inc.get(d, {}), rat.get(d, {}), met.get(d, {})
        rows.append({
            "symbol": symbol,
            "period": f"{i.get('fiscalYear', d)}-{i.get('period', period)}",
            "report_date": d,
            "revenue": i.get("revenue"),
            "revenue_yoy": None,  # filled below
            "net_income": i.get("netIncome"),
            "gross_margin": r.get("grossProfitMargin"),
            "debt_to_equity": _pick(r, "debtToEquityRatio", "debtEquityRatio"),
            "current_ratio": r.get("currentRatio"),
            "fcf": _pick(r, "freeCashFlowPerShare"),
            "roe": _pick(m, "returnOnEquity"),
            "pe": _pick(r, "priceToEarningsRatio"),
            "ev_ebitda": _pick(m, "evToEBITDA", "enterpriseValueOverEBITDA"),
        })

    # YoY revenue growth. Annual data -> compare to prior fiscal year (lag 1);
    # quarterly data -> same quarter last year (lag 4).
    lag = 4 if period == "quarter" else 1
    rev = [row["revenue"] for row in rows]  # newest-first
    for idx, row in enumerate(rows):
        older = rev[idx + lag] if idx + lag < len(rev) else None
        if row["revenue"] and older:
            row["revenue_yoy"] = round(100 * (row["revenue"] / older - 1), 2)

    with db.connect() as conn:
        n = db.upsert(conn, "fundamentals", rows)
        db.log_ingest(conn, "fundamentals", symbol, n)
    return n

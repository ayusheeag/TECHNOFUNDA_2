"""Build the full US universe + fundamentals from Polygon's financials feed.

Polygon's free tier is 5 calls/min, so we use the filter-optional whole-market
SWEEP (each call returns ~100 companies) rather than per-ticker calls. One
throttled sweep of the last N fiscal years covers the entire market; we then
compute market cap (shares x latest price) to keep only names above a cap
threshold (default $1B), classify sector from the SIC code, and derive the
screener's fundamental metrics.

This replaces the FMP watchlist path for the universe. Runs ~25-40 min for a
2-year sweep on the free tier -- a background / weekly job, not per-page-load.
"""
from __future__ import annotations

import time
from datetime import date, timedelta

import pandas as pd

from src.db import database as db
from src.providers import polygon as pg
from src.providers.sic import sic_to_sector


def sweep_financials(period_gte: str, *, throttle: float = 13.0,
                     max_pages: int = 600, log=print) -> list[dict]:
    """Paginate the whole-market annual financials sweep. Returns parsed rows."""
    out: list[dict] = []
    data = pg.financials(timeframe="annual", limit=100, period_gte=period_gte)
    pages = 0
    while True:
        for r in data.get("results", []):
            p = pg.parse_financials(r)
            if p["ticker"]:
                out.append(p)
        pages += 1
        if pages % 10 == 0:
            log(f"  sweep: {pages} pages, {len(out)} statements")
        nxt = data.get("next_url")
        if not nxt or pages >= max_pages:
            break
        time.sleep(throttle)
        data = pg.financials_next(nxt)
    log(f"  sweep done: {pages} pages, {len(out)} statements")
    return out


def _latest_close() -> dict[str, float]:
    """Latest close per symbol from daily_bars (for market cap)."""
    with db.connect() as conn:
        last = conn.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
        rows = conn.execute(
            "SELECT symbol, close FROM daily_bars WHERE date = ?", (last,)).fetchall()
    return {r[0]: r[1] for r in rows}


def _frac(a, b):
    return (a / b) if (a is not None and b) else None


def rebuild_universe(*, min_market_cap: float = 1e9, years: int = 2,
                     throttle: float = 13.0, log=print) -> tuple[int, int]:
    """Sweep financials, filter by market cap, and rebuild tickers + fundamentals.

    Returns (n_tickers, n_fundamental_rows).
    """
    period_gte = (date.today() - timedelta(days=365 * years + 30)).isoformat()
    log(f"sweeping financials since {period_gte} (throttle {throttle}s)...")
    parsed = sweep_financials(period_gte, throttle=throttle, log=log)
    if not parsed:
        log("no financials returned")
        return 0, 0

    df = pd.DataFrame(parsed)
    df = df[df["ticker"].notna() & df["revenue"].notna()]
    closes = _latest_close()

    tick_rows, fund_rows = [], []
    for tk, g in df.groupby("ticker"):
        g = g.sort_values("report_date")
        latest = g.iloc[-1]
        shares, close = latest["diluted_shares"], closes.get(tk)
        if not shares or not close:
            continue
        market_cap = close * shares
        if market_cap < min_market_cap:
            continue

        sector, industry = sic_to_sector(latest["sic"])
        tick_rows.append({
            "symbol": tk, "name": latest["company_name"], "exchange": None,
            "sector": sector, "industry": industry, "market_cap": market_cap,
            "is_active": 1, "updated_at": db.now_iso(),
        })

        revs = g.set_index("report_date")["revenue"].to_dict()
        rep_dates = list(g["report_date"])
        for i, (_, row) in enumerate(g.iterrows()):
            rev = row["revenue"]
            prior = g.iloc[i - 1]["revenue"] if i >= 1 else None
            yoy = round(100 * (rev / prior - 1), 2) if rev and prior else None
            eps = row["eps"]
            gm = _frac(row["gross_profit"], rev)
            de = _frac(row["long_term_debt"], row["equity"])
            cr = _frac(row["current_assets"], row["current_liabilities"])
            roe = _frac(row["net_income"], row["equity"])
            pe = round(close / eps, 2) if eps and eps > 0 else None
            oi = row["operating_income"]
            ev_ebitda = round((market_cap + (row["long_term_debt"] or 0)) / oi, 1) \
                if oi and oi > 0 else None
            fcf = _frac(row["op_cash_flow"], shares)
            fund_rows.append({
                "symbol": tk, "period": str(row["fiscal_year"] or row["report_date"]),
                "report_date": row["report_date"], "revenue": rev,
                "revenue_yoy": yoy, "net_income": row["net_income"],
                "gross_margin": round(gm, 4) if gm is not None else None,
                "debt_to_equity": round(de, 4) if de is not None else None,
                "current_ratio": round(cr, 4) if cr is not None else None,
                "fcf": round(fcf, 4) if fcf is not None else None,
                "roe": round(roe, 4) if roe is not None else None,
                "pe": pe, "ev_ebitda": ev_ebitda,
            })

    with db.connect() as conn:
        conn.execute("DELETE FROM tickers")
        conn.execute("DELETE FROM fundamentals")
        conn.commit()
        n_t = db.upsert(conn, "tickers", tick_rows)
        n_f = db.upsert(conn, "fundamentals", fund_rows)
        db.log_ingest(conn, "polygon_universe", f">={min_market_cap:.0e}", n_t)
    log(f"universe rebuilt: {n_t} tickers (mktcap>{min_market_cap:.0e}), "
        f"{n_f} fundamental rows")
    return n_t, n_f

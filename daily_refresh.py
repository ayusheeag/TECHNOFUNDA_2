"""Backend daily refresh job (scheduled ~7 PM IST).

Pulls the latest data and PRE-COMPUTES every page's dataset into snapshot
tables, so the Streamlit app makes ZERO API calls on page load -- it just reads
these tables. Idempotent and resilient: each section is guarded so one failure
doesn't abort the rest.

Snapshot tables written (each fully replaced per run):
  breadth            -- daily breadth + regime (also kept incrementally)
  sector_scores      -- sector ETF technofunda scorecard
  stock_technicals   -- per-universe stock: technicals + stage + RS + IBD50 tag
  screen_results     -- default technofunda screen (growth>=15, RS, stage)
  rerating_scores    -- re-rating scorecard
  earnings_enriched  -- earnings calendar + name + consensus EPS + trailing P/E
  refresh_meta       -- last run timestamps + status (for the app's "as of" line)

Run manually:  python daily_refresh.py
"""
from __future__ import annotations

import time
import traceback
from datetime import date, datetime, timedelta, timezone

import pandas as pd

import config
from src.db import database as db

THROTTLE = 0.3         # seconds between Polygon calls (paid tier = unlimited; small delay is just politeness)
EARNINGS_DAYS = 21     # look-ahead window for the earnings calendar
PE_CAP = 60            # max trailing-P/E lookups per run (FMP budget)
IST = timezone(timedelta(hours=5, minutes=30))


def _store(conn, name: str, df: pd.DataFrame) -> None:
    """Replace a snapshot table with a DataFrame (schema follows the frame)."""
    db.store_df(name, df)


def _log(msg: str) -> None:
    print(f"[{datetime.now(IST).strftime('%H:%M:%S')}] {msg}", flush=True)


# --- ingestion ------------------------------------------------------------

def refresh_prices() -> int:
    """Incrementally ingest new trading days, storing only the classified
    universe (+ sector ETFs + SPY/QQQ) so the DB fits free-tier storage."""
    from src.analysis.sectors import SECTOR_ETFS
    from src.ingest.prices import ingest_grouped_day
    with db.connect() as conn:
        last = conn.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0]
        keep = {r[0] for r in conn.execute("SELECT symbol FROM tickers")}
    keep |= set(SECTOR_ETFS.values()) | {"SPY", "QQQ"}
    start = (date.fromisoformat(last) + timedelta(days=1)) if last else date.today() - timedelta(days=540)
    end = date.today()
    n = 0
    d = start
    while d <= end:
        if d.weekday() < 5:
            try:
                if ingest_grouped_day(d.isoformat(), keep_symbols=keep):
                    n += 1
                    time.sleep(THROTTLE)
            except Exception as e:
                _log(f"  price {d}: {e}")
        d += timedelta(days=1)
    _log(f"prices: {n} new trading day(s) ingested (universe-only)")
    _backfill_missing_history(keep)
    return n


BACKFILL_YEARS = 2         # history depth for names new to the universe
BACKFILL_MIN_BARS = 300    # fewer bars than this ⇒ treat as new, backfill its history


def _backfill_missing_history(keep: set[str]) -> int:
    """Backfill ~BACKFILL_YEARS of daily history for universe names that lack it
    (new members after a mcap-floor change). Grouped-daily over the window,
    storing only the missing names — idempotent (ON CONFLICT), so names that
    already have history are untouched."""
    from src.ingest.prices import ingest_grouped_day
    with db.connect() as conn:
        have = {r[0]: r[1] for r in conn.execute("SELECT symbol, COUNT(*) FROM daily_bars GROUP BY symbol")}
        done = {r[0] for r in conn.execute("SELECT key FROM ingest_log WHERE source='history_backfill'")}
    # A name is "new" if it lacks history AND we haven't already backfilled it
    # (young IPOs stay short forever — mark them done so we don't re-sweep nightly).
    new = sorted(s for s in keep if have.get(s, 0) < BACKFILL_MIN_BARS and s not in done)
    if not new:
        _log("prices: no names need a history backfill")
        return 0
    _log(f"prices: backfilling ~{BACKFILL_YEARS}y for {len(new)} name(s)...")
    newset = set(new)
    start = date.today() - timedelta(days=int(BACKFILL_YEARS * 365.25) + 10)
    d, days = start, 0
    while d <= date.today():
        if d.weekday() < 5:
            try:
                ingest_grouped_day(d.isoformat(), skip_if_done=False, keep_symbols=newset)
                days += 1
                time.sleep(THROTTLE)
            except Exception as e:
                _log(f"  backfill {d}: {e}")
        d += timedelta(days=1)
    with db.connect() as conn:
        for s in new:
            try:
                db.log_ingest(conn, "history_backfill", s, have.get(s, 0))
            except Exception:
                pass
    _log(f"prices: backfilled {len(new)} names across {days} days")
    return len(new)


def refresh_sector_etfs() -> None:
    from src.analysis.sectors import SECTOR_ETFS
    from src.ingest.prices import backfill_symbol
    end = date.today()
    start = end - timedelta(days=20)   # top up recent bars only
    for etf in SECTOR_ETFS.values():
        try:
            backfill_symbol(etf, start.isoformat(), end.isoformat())
        except Exception as e:
            _log(f"  etf {etf}: {e}")
    _log("sector ETFs topped up")


FUND_MIN_MKTCAP = 1e8      # universe cap threshold ($100M — small-caps included)
FUND_MAX_AGE_DAYS = 7      # rebuild the whole-universe fundamentals at most weekly


def refresh_fundamentals(force: bool = False) -> int:
    """Rebuild the full US universe + fundamentals from Polygon's financials
    sweep. Fundamentals change quarterly, so this runs at most weekly (unless
    forced). Auto-forces when the market-cap floor was lowered (the stored
    universe's floor sits well above FUND_MIN_MKTCAP), so a floor change takes
    effect on the next run without a manual force."""
    from datetime import datetime, timezone

    from src.ingest.fundamentals_polygon import rebuild_universe
    with db.connect() as conn:
        row = conn.execute(
            "SELECT fetched_at FROM ingest_log WHERE source='polygon_universe' "
            "ORDER BY fetched_at DESC LIMIT 1").fetchone()
        try:
            cur_min = conn.execute("SELECT MIN(market_cap) FROM tickers WHERE market_cap > 0").fetchone()[0]
            if cur_min and cur_min > FUND_MIN_MKTCAP * 1.5:
                force = True
                _log(f"fundamentals: mcap floor lowered ({cur_min/1e9:.2f}B stored vs {FUND_MIN_MKTCAP/1e9:.2f}B) — forcing rebuild")
        except Exception:
            pass
    if row and not force:
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(row[0])).days
            if age < FUND_MAX_AGE_DAYS:
                _log(f"fundamentals: universe {age}d old (<{FUND_MAX_AGE_DAYS}), skip rebuild")
                return 0
        except Exception:
            pass
    n_t, _ = rebuild_universe(min_market_cap=FUND_MIN_MKTCAP, years=2,
                              throttle=THROTTLE, log=_log)
    return n_t


def refresh_ibd50() -> int:
    from src.providers.ibd50 import refresh
    try:
        n = refresh()
        _log(f"IBD50: {n} symbols")
        return n
    except Exception as e:
        _log(f"  ibd50: {e}")
        return 0


# --- precompute snapshots -------------------------------------------------

def refresh_breadth() -> dict:
    """Update the breadth table incrementally (full bootstrap only if no EMA
    state yet). Loads just a trailing window instead of all history, and skips
    entirely when no new trading day has been added."""
    from src.analysis.breadth import (compute_breadth, incremental_breadth,
                                      latest_regime)
    with db.connect() as conn:
        tabs = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        bmax = conn.execute("SELECT MAX(date) FROM breadth").fetchone()[0] \
            if "breadth" in tabs else None
        has_state = ("breadth_state" in tabs and conn.execute(
            "SELECT COUNT(*) FROM breadth_state").fetchone()[0] > 0)
        all_dates = [r[0] for r in conn.execute(
            "SELECT DISTINCT date FROM daily_bars ORDER BY date")]
    if not all_dates:
        return {}

    if not bmax or not has_state:                 # first time -> full + state
        with db.connect() as conn:
            bars = db.load_bars(conn)
        breadth, state = compute_breadth(bars, return_state=True)
        with db.connect() as conn:
            db.upsert(conn, "breadth", breadth.to_dict("records"))
            _store(conn, "breadth_state", state)
        _log(f"breadth: full bootstrap, {len(breadth)} dates")
        return latest_regime(breadth)

    new_dates = [d for d in all_dates if d > bmax]
    if not new_dates:
        _log("breadth: already current (skipped)")
        return latest_regime(db.read_df("SELECT * FROM breadth"))

    idx0 = all_dates.index(new_dates[0])
    cutoff = all_dates[max(0, idx0 - config.HIGH_52W - 1)]   # trailing window
    window = db.read_df(
        "SELECT symbol,date,close,volume FROM daily_bars WHERE date >= ?", [cutoff])
    prev_state = db.read_df("SELECT * FROM breadth_state")
    rows, new_state = incremental_breadth(window, prev_state, new_dates)
    with db.connect() as conn:
        db.upsert(conn, "breadth", rows.to_dict("records"))
        _store(conn, "breadth_state", new_state)
    latest = latest_regime(db.read_df("SELECT * FROM breadth"))
    _log(f"breadth: +{len(new_dates)} new date(s) incrementally "
         f"(window {len(window):,} rows), regime={latest.get('regime')}")
    return latest


def compute_snapshots() -> dict:
    from src.analysis.rerating import rerating_scorecard
    from src.analysis.screener import screen
    from src.analysis.sectors import (SECTOR_ETFS, score_sector_etfs,
                                      stock_technicals_by_sector)
    from src.analysis.stage import classify_stage
    from src.providers.ibd50 import ibd50_symbols

    # Breadth first (incremental, loads its own trailing window).
    reg = refresh_breadth()
    info = {"regime": reg.get("regime"), "pct_above_200ema": reg.get("pct_above_200ema")}

    # Everything else needs only the classified universe + sector ETFs + SPY,
    # so load just those bars (~thousands of rows) rather than the whole market.
    fund = db.read_df("SELECT * FROM fundamentals")
    tick = db.read_df("SELECT * FROM tickers")
    with db.connect() as conn:
        uni = (set(tick["symbol"].dropna()) | set(SECTOR_ETFS.values()) | {"SPY"})
        bars = db.load_bars(conn, symbols=list(uni))
    spy = bars[bars["symbol"] == "SPY"]

    from src.analysis.stage import stage_snapshot
    # Vectorised stage for the WHOLE universe in one pass (not a per-symbol loop).
    stg = stage_snapshot(bars, symbols=list(uni))
    stage_map = dict(zip(stg["symbol"], stg["stage"])) if not stg.empty else {}
    label_map = dict(zip(stg["symbol"], stg["stage_label"])) if not stg.empty else {}

    # Vectorised RS line vs SPY + new-high flag for the whole universe.
    rs_line_map, rs_new_map = {}, {}
    if not spy.empty:
        bench = spy.sort_values("date").set_index("date")["close"].astype(float)
        rb = bars[["symbol", "date", "close"]].copy()
        rb["bench"] = rb["date"].map(bench)
        rb = rb.dropna(subset=["bench"]).sort_values(["symbol", "date"])
        rb["rs"] = rb["close"] / rb["bench"]
        rb["rs_hi"] = (rb.groupby("symbol", sort=False)["rs"]
                       .rolling(config.HIGH_52W, min_periods=5).max()
                       .reset_index(level=0, drop=True))
        last = rb.groupby("symbol", sort=False).tail(1)
        for _, r in last.iterrows():
            rs_line_map[r["symbol"]] = round(float(r["rs"]), 4) if pd.notna(r["rs"]) else None
            rs_new_map[r["symbol"]] = bool(pd.notna(r["rs_hi"]) and r["rs"] >= r["rs_hi"] * 0.98)

    with db.connect() as conn:
        # Sector scorecard.
        etf_bars = bars[bars["symbol"].isin(SECTOR_ETFS.values())]
        if not etf_bars.empty:
            _store(conn, "sector_scores", score_sector_etfs(etf_bars))
            _log("sector_scores stored")

        # Per-universe stock technicals + stage + RS + IBD50.
        cons = stock_technicals_by_sector(bars, tick, ibd50=ibd50_symbols())
        if not cons.empty:
            cons["stage"] = cons["symbol"].map(stage_map)
            cons["stage_label"] = cons["symbol"].map(label_map)
            cons["rs_line"] = cons["symbol"].map(rs_line_map)
            cons["rs_new_high"] = cons["symbol"].map(rs_new_map)
            _store(conn, "stock_technicals", cons)
            _log(f"stock_technicals stored ({len(cons)} names)")

        # Default screen (growth>=15) + stage/RS from the vectorised maps.
        if not fund.empty:
            out = screen(bars, fund, tick, min_rev_growth=15,
                         benchmark_bars=spy if not spy.empty else None)
            if not out.empty:
                out = out.copy()
                out["stage"] = out["symbol"].map(stage_map)
                out["stage_label"] = out["symbol"].map(label_map)
            _store(conn, "screen_results", out)
            _log(f"screen_results stored ({len(out)} candidates)")

            # Re-rating.
            _store(conn, "rerating_scores", rerating_scorecard(fund, tick))
            _log("rerating_scores stored")

    return info


def refresh_earnings_calendar() -> int:
    """Persist the full-market forward earnings calendar (Alpha Vantage) to a DB
    snapshot so the API reads a stable table instead of calling AV live on every
    cold start — AV's free tier is 25 calls/day, which redeploys can exhaust.
    Keeps the previous snapshot if AV returns empty (never overwrites with [])."""
    from api.live import fetch_earnings_calendar
    try:
        cal = fetch_earnings_calendar()
    except Exception as e:
        _log(f"  earnings_calendar fetch: {e}")
        return 0
    if not cal:
        _log("  earnings_calendar: AV empty — kept previous snapshot")
        return 0
    df = pd.DataFrame([{"symbol": c["symbol"], "name": c["name"], "date": c["date"],
                        "eps_estimate": c["epsEstimate"], "time": c["time"]} for c in cal])
    df = df[df["symbol"].astype(bool) & df["date"].astype(bool)]
    with db.connect() as conn:
        _store(conn, "earnings_calendar", df)
    _log(f"earnings_calendar: {len(df)} events stored")
    return len(df)


def refresh_earnings() -> int:
    """Fetch upcoming earnings + enrich with name and trailing P/E; store snapshot."""
    from src.providers import fmp
    from src.providers.base import RestrictedError
    from src.providers.sec import resolve_names

    frm = date.today()
    to = frm + timedelta(days=EARNINGS_DAYS)
    try:
        rows = fmp.earnings_calendar(frm.isoformat(), to.isoformat())
    except Exception as e:
        _log(f"  earnings fetch: {e}")
        return 0
    df = pd.DataFrame(rows)
    if df.empty:
        return 0
    df = df.rename(columns={"epsEstimated": "eps_consensus",
                            "revenueEstimated": "rev_consensus"})
    names = resolve_names(df["symbol"].dropna().unique())
    df["name"] = df["symbol"].map(names)
    for rc in ("rev_consensus", "revenueActual"):
        if rc in df:
            df[rc] = pd.to_numeric(df[rc], errors="coerce") / 1e9   # -> $B

    # Trailing P/E for the soonest names, capped to respect the FMP budget.
    order = df.sort_values("date")["symbol"].dropna().unique()[:PE_CAP]
    pe = {}
    for s in order:
        try:
            data = fmp.ratios_ttm(s)
            v = data[0].get("priceToEarningsRatioTTM") if data else None
            pe[s] = round(v, 1) if v is not None else None
        except (RestrictedError, Exception):
            pe[s] = None
        time.sleep(0.3)
    df["trailing_pe"] = df["symbol"].map(pe)

    keep = [c for c in ["date", "symbol", "name", "eps_consensus", "epsActual",
                        "trailing_pe", "rev_consensus", "revenueActual", "time"]
            if c in df]
    df = df[keep].sort_values("date")
    with db.connect() as conn:
        _store(conn, "earnings_enriched", df)
    _log(f"earnings_enriched stored ({len(df)} events, {sum(v is not None for v in pe.values())} P/Es)")
    return len(df)


# --- orchestration --------------------------------------------------------

def main() -> int:
    started = datetime.now(timezone.utc)
    _log("=== daily_refresh start ===")
    status, summary = "ok", []
    info = {}
    # Note: sector ETFs (SPY, XLK, ...) are included in the grouped-daily feed,
    # so refresh_prices() already updates them -- no separate ETF step needed.
    for step_name, fn in [
        ("prices", refresh_prices),
        ("fundamentals", refresh_fundamentals),
        ("ibd50", refresh_ibd50),
        ("earnings", refresh_earnings),
        ("earnings_calendar", refresh_earnings_calendar),
    ]:
        try:
            fn()
        except Exception:
            status = "partial"
            summary.append(f"{step_name} failed")
            _log(f"  !! {step_name} failed:\n{traceback.format_exc()}")
    try:
        info = compute_snapshots()
    except Exception:
        status = "partial"
        summary.append("snapshots failed")
        _log(f"  !! snapshots failed:\n{traceback.format_exc()}")

    finished = datetime.now(timezone.utc)
    meta = pd.DataFrame([{
        "last_run_utc": finished.isoformat(timespec="seconds"),
        "last_run_ist": finished.astimezone(IST).strftime("%Y-%m-%d %H:%M IST"),
        "duration_sec": int((finished - started).total_seconds()),
        "status": status,
        "regime": info.get("regime"),
        "pct_above_200ema": info.get("pct_above_200ema"),
        "summary": "; ".join(summary) or "all steps ok",
    }])
    with db.connect() as conn:
        _store(conn, "refresh_meta", meta)
    _log(f"=== done ({status}) in {meta.iloc[0]['duration_sec']}s ===")
    return 0 if status == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())

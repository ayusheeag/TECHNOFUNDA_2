"""One-shot pipeline runner.

Runs the whole flow end-to-end once your API keys are in .env:

  init-db -> universe -> sector ETFs -> daily bars -> fundamentals
          -> breadth -> sectors -> screen -> rerating

Free-tier friendly: price/fundamental pulls are throttled so you stay under
rate limits (Polygon free = 5 calls/min). Tune with --throttle, or upgrade and
set --throttle 0.

Examples
--------
  # See the plan without calling any API
  python bootstrap.py --dry-run

  # Full run: ~1.5 yrs of bars (enough for 200EMA / 52w), top 40 names' fundamentals
  python bootstrap.py --start 2025-01-01 --end 2026-07-21 --fundamentals-top 40

  # Skip the slow price backfill (reuse what's already ingested) and just
  # recompute the analysis
  python bootstrap.py --skip-prices --skip-fundamentals
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date, timedelta

import pandas as pd
from rich.console import Console
from rich.table import Table

import config
from src.db import database as db

console = Console()


# --- helpers --------------------------------------------------------------

def _default_dates() -> tuple[str, str]:
    """~18 months back to yesterday -> enough history for 200EMA & 52w windows."""
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=548)
    return start.isoformat(), end.isoformat()


def _print_df(df: pd.DataFrame, title: str, max_rows: int = 25) -> None:
    if df is None or df.empty:
        console.print(f"[yellow]{title}: no data[/yellow]")
        return
    table = Table(title=title)
    for c in df.columns:
        table.add_column(str(c))
    for _, row in df.head(max_rows).iterrows():
        table.add_row(*[f"{v:.2f}" if isinstance(v, float) else str(v) for v in row])
    console.print(table)


def preflight(need_fmp: bool, need_polygon: bool) -> bool:
    """Check required keys are present; return True if good to go."""
    ok = True
    if need_fmp and not config.FMP_API_KEY:
        console.print("[red]FMP_API_KEY missing[/red] -> universe, fundamentals, "
                      "calendar, transcripts will fail. Add it to .env.")
        ok = False
    if need_polygon and not config.POLYGON_API_KEY:
        console.print("[red]POLYGON_API_KEY missing[/red] -> price bars & breadth "
                      "will fail. Add it to .env.")
        ok = False
    if ok:
        console.print("[green]Preflight OK[/green] - required keys present.")
    return ok


def step(title: str) -> None:
    console.rule(f"[bold cyan]{title}")


# --- pipeline stages ------------------------------------------------------

def run(args: argparse.Namespace) -> int:
    start, end = args.start, args.end
    plan = [
        ("init-db", True),
        ("universe", not args.skip_universe),
        ("sector ETFs", not args.skip_prices),
        (f"daily bars {start}..{end}", not args.skip_prices),
        (f"fundamentals (top {args.fundamentals_top})", not args.skip_fundamentals),
        ("breadth", True),
        ("sectors", True),
        ("screen", True),
        ("rerating", True),
    ]
    console.print("[bold]Pipeline plan:[/bold]")
    for name, enabled in plan:
        console.print(f"  {'[green]run [/green]' if enabled else '[dim]skip[/dim]'} {name}")
    console.print(f"  throttle: {args.throttle}s between API calls\n")

    if args.dry_run:
        console.print("[yellow]--dry-run: no API calls made.[/yellow]")
        return 0

    need_polygon = not args.skip_prices
    need_fmp = not (args.skip_universe and args.skip_fundamentals)
    if not preflight(need_fmp, need_polygon) and not args.force:
        console.print("[red]Aborting. Fix keys or pass --force to run partial.[/red]")
        return 1

    # 1. DB ----------------------------------------------------------------
    step("init-db")
    db.init_db()

    # 2. Universe ----------------------------------------------------------
    if not args.skip_universe:
        step("ingest universe")
        from pathlib import Path

        from src.ingest.fundamentals import (ingest_universe_from_symbols,
                                             ingest_universe_via_screener)
        if args.use_screener:
            ingest_universe_via_screener(min_market_cap=args.min_cap)
        else:
            wl = Path(args.watchlist)
            if not wl.exists():
                console.print(f"[red]Watchlist {wl} not found; skipping universe.[/red]")
            else:
                syms = [ln.strip() for ln in wl.read_text().splitlines()
                        if ln.strip() and not ln.startswith("#")]
                ingest_universe_from_symbols(syms, throttle=min(args.throttle, 1.0))

    # 3. Sector ETFs (needed for the sector scorecard) ---------------------
    if not args.skip_prices:
        step("backfill sector ETFs")
        from src.analysis.sectors import SECTOR_ETFS
        from src.ingest.prices import backfill_symbol
        for etf in SECTOR_ETFS.values():
            try:
                backfill_symbol(etf, start, end)
            except Exception as e:  # keep going; one ETF failing isn't fatal
                console.print(f"[yellow]{etf}: {e}[/yellow]")
            time.sleep(args.throttle)

    # 4. Daily bars for the whole market (breadth universe) ----------------
    if not args.skip_prices:
        step(f"ingest grouped daily bars {start}..{end}")
        from src.ingest.prices import ingest_grouped_day
        d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
        d = d0
        n_days = 0
        while d <= d1:
            if d.weekday() < 5:
                try:
                    ingest_grouped_day(d.isoformat())
                    n_days += 1
                except Exception as e:
                    console.print(f"[yellow]{d}: {e}[/yellow]")
                time.sleep(args.throttle)
            d += timedelta(days=1)
        console.print(f"[green]Ingested ~{n_days} trading days.[/green]")

    # 5. Fundamentals for the top-N names by market cap --------------------
    if not args.skip_fundamentals:
        step(f"ingest fundamentals (top {args.fundamentals_top} by market cap)")
        from src.ingest.fundamentals import ingest_fundamentals
        with db.connect() as conn:
            syms = [r[0] for r in conn.execute(
                "SELECT symbol FROM tickers WHERE market_cap IS NOT NULL "
                "ORDER BY market_cap DESC LIMIT ?", (args.fundamentals_top,)
            ).fetchall()]
        if not syms:
            console.print("[yellow]No tickers in DB - run without --skip-universe "
                          "first.[/yellow]")
        for s in syms:
            try:
                n = ingest_fundamentals(s)
                console.print(f"  {s}: {n} rows")
            except Exception as e:
                console.print(f"[yellow]{s}: {e}[/yellow]")
            time.sleep(args.throttle)

    # 6. Breadth -> regime -------------------------------------------------
    step("breadth & market regime")
    from src.analysis.breadth import compute_breadth, latest_regime
    with db.connect() as conn:
        bars = db.load_bars(conn)
        if bars.empty:
            console.print("[red]No bars in DB - breadth/sector/screen skipped.[/red]")
            return 2
        breadth = compute_breadth(bars)
        db.upsert(conn, "breadth", breadth.to_dict("records"))
    _print_df(breadth[["date", "universe_size", "pct_above_200ema",
                       "new_52w_highs", "regime"]].tail(10), "Breadth (recent)")
    latest = latest_regime(breadth)
    if latest:
        console.print(f"\n[bold]Regime:[/bold] [green]{latest.get('regime')}[/green] "
                      f"(% above 200EMA = {latest.get('pct_above_200ema')}) -> "
                      "aggressive=size up, moderate=normal, shallow=defensive.\n")

    # 7. Sector scorecard --------------------------------------------------
    step("sector technofunda scorecard")
    from src.analysis.sectors import SECTOR_ETFS, score_sector_etfs
    with db.connect() as conn:
        etf_bars = db.load_bars(conn, symbols=list(SECTOR_ETFS.values()))
    if not etf_bars.empty:
        _print_df(score_sector_etfs(etf_bars), "Sectors (sound & not stretched first)")
    else:
        console.print("[yellow]No sector ETF bars - run without --skip-prices.[/yellow]")

    # 8. Stock screen ------------------------------------------------------
    step("stock screen")
    from src.analysis.screener import screen
    with db.connect() as conn:
        all_bars = db.load_bars(conn)
        fundamentals = db.read_df("SELECT * FROM fundamentals", conn=conn)
        tickers = db.read_df("SELECT * FROM tickers", conn=conn)
    if fundamentals.empty:
        console.print("[yellow]No fundamentals - screen/rerating skipped.[/yellow]")
        return 0
    cand = screen(all_bars, fundamentals, tickers, min_rev_growth=args.min_growth)
    _print_df(cand, "Screen candidates")

    # 9. Re-rating ---------------------------------------------------------
    step("re-rating scorecard")
    from src.analysis.rerating import rerating_scorecard
    _print_df(rerating_scorecard(fundamentals, tickers),
              "Re-rating (cheap-vs-self + accelerating growth first)")

    console.rule("[bold green]Pipeline complete")
    return 0


def main() -> int:
    d_start, d_end = _default_dates()
    p = argparse.ArgumentParser(description="Run the full screener pipeline.")
    p.add_argument("--start", default=d_start, help=f"Bars start (default {d_start}).")
    p.add_argument("--end", default=d_end, help=f"Bars end (default {d_end}).")
    p.add_argument("--min-cap", type=float, default=1e9, help="Universe min market cap.")
    p.add_argument("--min-growth", type=float, default=10.0, help="Screen min rev growth %.")
    p.add_argument("--fundamentals-top", type=int, default=40,
                   help="How many top-cap names to pull fundamentals for.")
    p.add_argument("--watchlist", default="watchlist.txt",
                   help="Ticker file for the free-tier universe (one per line).")
    p.add_argument("--use-screener", action="store_true",
                   help="PAID: build universe via FMP bulk screener.")
    p.add_argument("--throttle", type=float, default=13.0,
                   help="Seconds between API calls (Polygon free=5/min -> ~13s).")
    p.add_argument("--skip-universe", action="store_true")
    p.add_argument("--skip-prices", action="store_true")
    p.add_argument("--skip-fundamentals", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="Print plan, call nothing.")
    p.add_argument("--force", action="store_true", help="Run even if keys are missing.")
    args = p.parse_args()
    try:
        return run(args)
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted.[/yellow]")
        return 130


if __name__ == "__main__":
    sys.exit(main())

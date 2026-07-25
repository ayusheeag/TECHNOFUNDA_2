"""Command-line entry point for the screener.

Usage examples (from the project root, with .venv active):

  python -m src.cli init-db
  python -m src.cli ingest-universe --min-cap 1e9
  python -m src.cli ingest-prices --start 2024-01-02 --end 2024-12-31
  python -m src.cli ingest-fundamentals AAPL MSFT NVDA
  python -m src.cli ingest-calendar --from 2026-07-22 --to 2026-08-22
  python -m src.cli breadth
  python -m src.cli sectors            # needs sector ETF bars ingested
  python -m src.cli screen --industry "Semiconductors" --min-growth 15
  python -m src.cli rerating --setups-only
  python -m src.cli concall NVDA --year 2026 --quarter 1
  python -m src.cli concall NVDA --year 2026 --quarter 1 --llm
"""
from __future__ import annotations

import click
import pandas as pd
from rich.console import Console
from rich.table import Table

import config
from src.db import database as db

console = Console()


def _print_df(df: pd.DataFrame, title: str, max_rows: int = 30) -> None:
    if df is None or df.empty:
        console.print(f"[yellow]{title}: no data[/yellow]")
        return
    table = Table(title=title, show_lines=False)
    for col in df.columns:
        table.add_column(str(col))
    for _, row in df.head(max_rows).iterrows():
        table.add_row(*[f"{v:.2f}" if isinstance(v, float) else str(v) for v in row])
    console.print(table)


@click.group()
def cli() -> None:
    """US stock technofunda screener."""


@cli.command("init-db")
def init_db_cmd() -> None:
    db.init_db()


@cli.command("ingest-universe")
@click.option("--watchlist", default="watchlist.txt",
              help="File of tickers (one per line) for the free-tier profile path.")
@click.option("--use-screener", is_flag=True,
              help="PAID: build the universe via FMP's bulk screener instead.")
@click.option("--min-cap", default=1e9, type=float, help="Min market cap (screener).")
@click.option("--throttle", default=0.0, type=float, help="Seconds between profile calls.")
def ingest_universe_cmd(watchlist: str, use_screener: bool, min_cap: float,
                        throttle: float) -> None:
    from pathlib import Path

    from src.ingest.fundamentals import (ingest_universe_from_symbols,
                                         ingest_universe_via_screener)
    if use_screener:
        ingest_universe_via_screener(min_market_cap=min_cap)
        return
    path = Path(watchlist)
    if not path.exists():
        console.print(f"[red]Watchlist not found: {path}. "
                      f"Create it or pass --watchlist.[/red]")
        return
    symbols = [ln.strip() for ln in path.read_text().splitlines()
               if ln.strip() and not ln.startswith("#")]
    ingest_universe_from_symbols(symbols, throttle=throttle)


@cli.command("ingest-prices")
@click.option("--start", required=True)
@click.option("--end", required=True)
def ingest_prices_cmd(start: str, end: str) -> None:
    from src.ingest.prices import ingest_grouped_range
    ingest_grouped_range(start, end)


@cli.command("ingest-fundamentals")
@click.argument("symbols", nargs=-1, required=True)
def ingest_fundamentals_cmd(symbols: tuple[str, ...]) -> None:
    from src.ingest.fundamentals import ingest_fundamentals
    for s in symbols:
        n = ingest_fundamentals(s.upper())
        console.print(f"{s.upper()}: {n} fundamental rows")


@cli.command("ingest-calendar")
@click.option("--from", "from_date", required=True)
@click.option("--to", "to_date", required=True)
def ingest_calendar_cmd(from_date: str, to_date: str) -> None:
    from src.ingest.calendar import ingest_earnings_calendar
    ingest_earnings_calendar(from_date, to_date)


@cli.command("breadth")
@click.option("--start", default=None, help="Only compute from this date.")
@click.option("--save/--no-save", default=True, help="Persist to breadth table.")
def breadth_cmd(start: str | None, save: bool) -> None:
    from src.analysis.breadth import compute_breadth, latest_regime
    with db.connect() as conn:
        bars = db.load_bars(conn, start=start)
        if bars.empty:
            console.print("[red]No bars loaded. Run ingest-prices first.[/red]")
            return
        out = compute_breadth(bars)
        if save:
            db.upsert(conn, "breadth", out.to_dict("records"))
    _print_df(out.tail(15), "Breadth (recent)")
    latest = latest_regime(out)
    if latest:
        console.print(
            f"\n[bold]Latest regime:[/bold] [green]{latest.get('regime')}[/green]  "
            f"(% above 200EMA = {latest.get('pct_above_200ema')})"
        )
        console.print(
            "Position sizing -> "
            "aggressive = size up, moderate = normal, shallow = defensive/cash."
        )


@cli.command("sectors")
def sectors_cmd() -> None:
    from src.analysis.sectors import SECTOR_ETFS, score_sector_etfs
    with db.connect() as conn:
        bars = db.load_bars(conn, symbols=list(SECTOR_ETFS.values()))
    if bars.empty:
        console.print("[red]No sector ETF bars. Backfill XLK, XLF, ... first.[/red]")
        return
    _print_df(score_sector_etfs(bars), "Sector technofunda scorecard")


@cli.command("ingest-transcript")
@click.argument("symbol")
@click.argument("year", type=int)
@click.argument("quarter", type=int)
def ingest_transcript_cmd(symbol: str, year: int, quarter: int) -> None:
    from src.ingest.calendar import ingest_transcript
    ingest_transcript(symbol.upper(), year, quarter)


@cli.command("rerating")
@click.option("--sector", multiple=True, help="Restrict to sectors.")
@click.option("--setups-only", is_flag=True, help="Only rows flagged rerating_setup.")
def rerating_cmd(sector: tuple[str, ...], setups_only: bool) -> None:
    from src.analysis.rerating import rerating_scorecard
    fundamentals = db.read_df("SELECT * FROM fundamentals")
    tickers = db.read_df("SELECT * FROM tickers")
    if fundamentals.empty:
        console.print("[red]Need fundamentals ingested first.[/red]")
        return
    out = rerating_scorecard(fundamentals, tickers)
    if sector:
        out = out[out["sector"].isin(sector)]
    if setups_only:
        out = out[out["rerating_setup"]]
    _print_df(out, "Re-rating scorecard (cheap-vs-self + accelerating growth)")


@cli.command("concall")
@click.argument("symbol")
@click.option("--year", type=int, required=True)
@click.option("--quarter", type=int, required=True)
@click.option("--llm", is_flag=True, help="Use Claude if ANTHROPIC_API_KEY is set.")
@click.option("--save/--no-save", default=True)
def concall_cmd(symbol: str, year: int, quarter: int, llm: bool, save: bool) -> None:
    from src.analysis.concall import (format_digest, summarise_transcript,
                                       summarise_with_claude)
    symbol = symbol.upper()
    period = f"{year}-Q{quarter}"
    with db.connect() as conn:
        row = conn.execute(
            "SELECT content FROM transcripts WHERE symbol=? AND period=?",
            (symbol, period)).fetchone()
        if not row or not row["content"]:
            console.print(f"[red]No transcript for {symbol} {period}. "
                          f"Run ingest-transcript first.[/red]")
            return
        content = row["content"]

        method, tone = "heuristic", None
        if llm:
            try:
                digest = summarise_with_claude(content)
                method = "claude"
            except RuntimeError as e:
                console.print(f"[yellow]LLM unavailable ({e}); using heuristic.[/yellow]")
                summary = summarise_transcript(content)
                digest = format_digest(symbol, period, summary)
                tone = summary["tone"]["tilt"]
        else:
            summary = summarise_transcript(content)
            digest = format_digest(symbol, period, summary)
            tone = summary["tone"]["tilt"]

        if save:
            db.upsert(conn, "concall_summaries", [{
                "symbol": symbol, "period": period, "method": method,
                "tone": tone, "digest": digest, "created_at": db.now_iso(),
            }])
    console.print(digest)


@cli.command("screen")
@click.option("--industry", multiple=True, help="Restrict to industries.")
@click.option("--min-growth", default=10.0, type=float)
def screen_cmd(industry: tuple[str, ...], min_growth: float) -> None:
    from src.analysis.screener import screen
    with db.connect() as conn:
        bars = db.load_bars(conn)
        fundamentals = db.read_df("SELECT * FROM fundamentals", conn=conn)
        tickers = db.read_df("SELECT * FROM tickers", conn=conn)
    if bars.empty or fundamentals.empty:
        console.print("[red]Need bars + fundamentals ingested first.[/red]")
        return
    out = screen(bars, fundamentals, tickers,
                 industries=list(industry) or None, min_rev_growth=min_growth)
    _print_df(out, "Screen candidates")


if __name__ == "__main__":
    cli()

"""Ingest daily price bars into SQLite.

Two modes:
  - backfill_symbol: history for one ticker (Polygon per-ticker aggs)
  - ingest_grouped_day: ALL US stocks for one date (Polygon grouped daily) --
    this is the efficient path for building the breadth universe.
"""
from __future__ import annotations

from datetime import date, timedelta

import config
from src.db import database as db
from src.providers import polygon


def ingest_grouped_day(trade_date: str, *, skip_if_done: bool = True,
                       keep_symbols: set[str] | None = None) -> int:
    """Fetch every US stock's bar for one date and upsert it.

    If `keep_symbols` is given, only those symbols are stored -- used in prod to
    keep the DB to the classified universe (fits free-tier Postgres storage).
    """
    with db.connect() as conn:
        if skip_if_done and db.already_fetched(conn, "grouped_daily", trade_date):
            print(f"{trade_date}: already ingested, skipping")
            return 0
        results = polygon.grouped_daily(trade_date)
        rows = polygon.to_bar_rows(results)
        if keep_symbols is not None:
            keep = set(keep_symbols)
            rows = [r for r in rows if r["symbol"] in keep]
        n = db.upsert(conn, "daily_bars", rows)
        db.log_ingest(conn, "grouped_daily", trade_date, n)
    print(f"{trade_date}: ingested {n} bars")
    return n


def ingest_grouped_range(start: str, end: str) -> int:
    """Ingest grouped daily bars for each weekday in [start, end].

    Weekends are skipped; market holidays simply return 0 rows.
    """
    d0 = date.fromisoformat(start)
    d1 = date.fromisoformat(end)
    total = 0
    d = d0
    while d <= d1:
        if d.weekday() < 5:  # Mon-Fri
            total += ingest_grouped_day(d.isoformat())
        d += timedelta(days=1)
    return total


def backfill_symbol(symbol: str, start: str, end: str) -> int:
    """Backfill full daily history for a single symbol."""
    results = polygon.daily_bars(symbol, start, end)
    rows = polygon.to_bar_rows(results, symbol=symbol)
    with db.connect() as conn:
        n = db.upsert(conn, "daily_bars", rows)
        db.log_ingest(conn, "symbol_backfill", f"{symbol}:{start}:{end}", n)
    print(f"{symbol}: backfilled {n} bars")
    return n

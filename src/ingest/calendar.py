"""Ingest earnings calendar + call transcripts from FMP."""
from __future__ import annotations

from src.db import database as db
from src.providers import fmp
from src.providers.base import RestrictedError


def ingest_earnings_calendar(from_date: str, to_date: str) -> int:
    rows = []
    for r in fmp.earnings_calendar(from_date, to_date):
        rows.append({
            "symbol": r.get("symbol"),
            "date": r.get("date"),
            "eps_est": r.get("epsEstimated"),
            "eps_actual": r.get("eps"),
            "rev_est": r.get("revenueEstimated"),
            "rev_actual": r.get("revenue"),
            "time": r.get("time"),
        })
    with db.connect() as conn:
        n = db.upsert(conn, "earnings_calendar", rows)
        db.log_ingest(conn, "earnings_calendar", f"{from_date}:{to_date}", n)
    print(f"earnings calendar {from_date}..{to_date}: {n} rows")
    return n


def ingest_transcript(symbol: str, year: int, quarter: int,
                      source: str = "alphavantage") -> int:
    """Fetch a concall transcript and store it.

    source="alphavantage" (default, FREE, 25/day) or "fmp" (paid plan).
    """
    symbol = symbol.upper()
    period = f"{year}-Q{quarter}"
    content = date = None

    if source == "fmp":
        try:
            data = fmp.transcript(symbol, year, quarter)
        except RestrictedError:
            print(f"{symbol} {period}: FMP transcripts need a paid plan.")
            return 0
        if data:
            content, date = data[0].get("content"), data[0].get("date")
    else:
        from src.providers import alphavantage as av
        from src.providers.base import ProviderError
        try:
            payload = av.earnings_transcript(symbol, year, quarter)
        except ProviderError as e:
            print(f"{symbol} {period}: {e}")
            return 0
        content, date = av.transcript_text(payload), av.transcript_date(payload)

    if not content:
        print(f"{symbol} {period}: empty transcript.")
        return 0
    with db.connect() as conn:
        n = db.upsert(conn, "transcripts", [{
            "symbol": symbol, "period": period, "date": date, "content": content,
        }])
        db.log_ingest(conn, "transcript", f"{symbol}:{year}Q{quarter}", n)
    print(f"transcript {symbol} {period}: stored ({len(content):,} chars)")
    return n

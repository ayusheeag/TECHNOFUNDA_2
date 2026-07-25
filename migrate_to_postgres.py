r"""One-off: copy all data from the local SQLite DB into Render Postgres.

Run LOCALLY, pointing DATABASE_URL at the Render Postgres EXTERNAL connection
string (from the Render dashboard):

    # PowerShell
    $env:DATABASE_URL="postgresql://user:pass@host/dbname"
    .\.venv\Scripts\python.exe migrate_to_postgres.py

It reads from data/screener.db and writes to the Postgres in DATABASE_URL.
daily_bars is ~4.5M rows, so this takes a few minutes over the network.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text

import config

# Tables defined in schema.sql (created WITH primary keys/indexes first).
CORE = ["tickers", "daily_bars", "fundamentals", "earnings_calendar",
        "transcripts", "breadth", "concall_summaries", "ingest_log"]
SCHEMA = Path("src/db/schema.sql").read_text()


def _norm(url: str) -> str:
    for p in ("postgresql://", "postgres://"):
        if url.startswith(p):
            return "postgresql+psycopg2://" + url[len(p):]
    return url


def main() -> int:
    dest_url = os.environ.get("DATABASE_URL")
    if not dest_url:
        print("Set DATABASE_URL to your Render Postgres external URL first.")
        return 1
    src = sqlite3.connect(str(config.DB_PATH))
    engine = create_engine(_norm(dest_url))

    # 1) Create core schema (PKs + indexes) on Postgres.
    print("creating schema on Postgres...")
    with engine.begin() as c:
        for stmt in SCHEMA.split(";"):
            if stmt.strip():
                c.execute(text(stmt))

    # 2) Copy every table.
    tables = [r[0] for r in src.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    for t in tables:
        n = src.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        if not n:
            print(f"  {t}: empty, skipped")
            continue
        if_exists = "append" if t in CORE else "replace"
        # chunked read+write to keep memory bounded on the 4.5M-row bars table.
        first = True
        for chunk in pd.read_sql_query(f"SELECT * FROM {t}", src, chunksize=50000):
            chunk.to_sql(t, engine, if_exists=(if_exists if first else "append"),
                         index=False, method="multi", chunksize=5000)
            first = False
        print(f"  {t}: {n} rows -> Postgres ({if_exists})")

    print("DONE. Verify row counts, then deploy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

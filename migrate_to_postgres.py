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
    # URL from env var, or from a local .neon_url file (gitignored) so the
    # password never has to be typed on a command line.
    dest_url = os.environ.get("DATABASE_URL")
    if not dest_url:
        p = Path(".neon_url")
        if p.exists():
            dest_url = p.read_text().strip()
    if not dest_url:
        print("No DATABASE_URL. Put your Neon connection string in a file named "
              ".neon_url in this folder, or set the DATABASE_URL env var.")
        return 1
    # Prefer the slimmed prod DB (universe-only bars) if it was built.
    prod_db = config.DATA_DIR / "screener_prod.db"
    src_path = prod_db if prod_db.exists() else config.DB_PATH
    print(f"source: {src_path.name}")
    src = sqlite3.connect(str(src_path))
    engine = create_engine(_norm(dest_url))

    # 1) Reset the Postgres DB (drop every existing table -- reclaims storage,
    #    clears any partial seed) then create the schema fresh.
    print("resetting + creating schema on Postgres...")
    import psycopg2
    raw = psycopg2.connect(dest_url)
    raw.autocommit = True
    cur = raw.cursor()
    cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")
    for (t,) in cur.fetchall():
        cur.execute(f'DROP TABLE IF EXISTS "{t}" CASCADE')
    cur.execute(SCHEMA)   # psycopg2 runs the multi-statement schema at once
    raw.close()

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

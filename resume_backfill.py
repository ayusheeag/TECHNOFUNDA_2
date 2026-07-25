"""Resume an interrupted backfill efficiently.

Skips already-ingested grouped-daily days WITHOUT sleeping on them (unlike a
fresh bootstrap run), then finishes fundamentals and recomputes breadth.
Safe to re-run; every step is idempotent.
"""
import time
from datetime import date, timedelta

from src.analysis.breadth import compute_breadth
from src.db import database as db
from src.ingest.fundamentals import ingest_fundamentals
from src.ingest.prices import ingest_grouped_day

THROTTLE = 13
START, END = date(2025, 1, 1), date(2026, 7, 22)

# 1) Finish whole-market daily bars (skip done days with no API call / no sleep).
with db.connect() as conn:
    done = {r[0] for r in conn.execute(
        "SELECT key FROM ingest_log WHERE source='grouped_daily'")}
print(f"[resume] {len(done)} grouped days already done; scanning for gaps...")

new_days = 0
d = START
while d <= END:
    if d.weekday() < 5 and d.isoformat() not in done:
        try:
            ingest_grouped_day(d.isoformat())
            new_days += 1
            time.sleep(THROTTLE)
        except Exception as e:
            print(f"  {d}: {e}")
    d += timedelta(days=1)
print(f"[resume] grouped daily complete: {new_days} new days ingested")

# 2) Fundamentals for the top-20 names by market cap (annual, free tier).
with db.connect() as conn:
    syms = [r[0] for r in conn.execute(
        "SELECT symbol FROM tickers WHERE market_cap IS NOT NULL "
        "ORDER BY market_cap DESC LIMIT 20")]
got = 0
for s in syms:
    try:
        if ingest_fundamentals(s):
            got += 1
        time.sleep(1)
    except Exception as e:
        print(f"  {s}: {e}")
print(f"[resume] fundamentals: {got}/{len(syms)} names have data")

# 3) Recompute breadth across the full history and persist it.
print("[resume] computing breadth across full history (this takes a few min)...")
with db.connect() as conn:
    bars = db.load_bars(conn)
    out = compute_breadth(bars)
    db.upsert(conn, "breadth", out.to_dict("records"))
latest = out.sort_values("date").iloc[-1]
print(f"[resume] breadth stored: {len(out)} dates. "
      f"Latest {latest['date']} -> {latest['regime']} "
      f"({latest['pct_above_200ema']}% above 200EMA)")
print("BACKFILL COMPLETE")

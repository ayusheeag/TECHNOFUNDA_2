"""Build a slimmed production DB that fits Neon's free 512 MB tier.

Keeps daily bars only for the classified universe (>$1B) + sector ETFs + SPY/QQQ
(the ~2,200 symbols the app actually uses), and recomputes breadth on that set
(so it's consistent "large-cap breadth"). Everything else (fundamentals,
snapshots, tickers) is small and copied as-is.

Output: data/screener_prod.db  (migrate_to_postgres.py seeds from it if present).
"""
from __future__ import annotations

import os
import shutil
import sqlite3

import pandas as pd

import config
from src.analysis.breadth import compute_breadth
from src.analysis.sectors import SECTOR_ETFS

SRC = str(config.DB_PATH)
DST = str(config.DATA_DIR / "screener_prod.db")


def main() -> int:
    print(f"copying {SRC} -> {DST}")
    shutil.copyfile(SRC, DST)
    conn = sqlite3.connect(DST)

    keep = {r[0] for r in conn.execute("SELECT symbol FROM tickers")}
    keep |= set(SECTOR_ETFS.values()) | {"SPY", "QQQ"}
    print(f"keeping bars for {len(keep)} symbols (universe + ETFs)")

    ph = ",".join("?" for _ in keep)
    before = conn.execute("SELECT COUNT(*) FROM daily_bars").fetchone()[0]
    conn.execute(f"DELETE FROM daily_bars WHERE symbol NOT IN ({ph})", tuple(keep))
    conn.commit()
    after = conn.execute("SELECT COUNT(*) FROM daily_bars").fetchone()[0]
    print(f"daily_bars: {before:,} -> {after:,} rows")
    conn.execute("VACUUM")

    # Recompute breadth (+ EMA state) on the universe-only bars.
    bars = pd.read_sql_query(
        "SELECT symbol,date,open,high,low,close,volume FROM daily_bars", conn)
    breadth, state = compute_breadth(bars, return_state=True)
    conn.execute("DELETE FROM breadth")
    breadth.to_sql("breadth", conn, if_exists="append", index=False)
    state.to_sql("breadth_state", conn, if_exists="replace", index=False)
    conn.commit()
    latest = breadth.sort_values("date").iloc[-1]
    print(f"breadth recomputed: {len(breadth)} dates, latest regime "
          f"{latest['regime']} ({latest['pct_above_200ema']}% of "
          f"{int(latest['universe_size'])} names above 200EMA)")

    conn.close()
    print(f"\nscreener_prod.db size: {os.path.getsize(DST)/1e6:.0f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

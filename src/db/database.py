"""Dual-dialect data layer: SQLite (local dev) or Postgres (prod).

Selection is automatic: if config.DATABASE_URL is set (Render Postgres), we use
Postgres; otherwise a local SQLite file at config.DB_PATH.

To keep the ~90 existing call sites unchanged, connect() returns a thin shim
whose .execute() accepts sqlite-style '?' placeholders (auto-converted to '%s'
for Postgres) and returns rows that support BOTH integer and string indexing
plus dict(row). pandas reads/writes go through read_df()/store_df() which use a
SQLAlchemy engine so they work on either backend.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Mapping, Sequence

import pandas as pd
from sqlalchemy import create_engine

import config

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
IS_PG = bool(config.DATABASE_URL)

# Primary keys per table, for dialect-aware upserts (Postgres ON CONFLICT).
_PK = {
    "tickers": ["symbol"],
    "daily_bars": ["symbol", "date"],
    "fundamentals": ["symbol", "period"],
    "earnings_calendar": ["symbol", "date"],
    "transcripts": ["symbol", "period"],
    "breadth": ["date"],
    "concall_summaries": ["symbol", "period", "method"],
    "ingest_log": ["source", "key"],
}


def _sa_url() -> str:
    if not IS_PG:
        return f"sqlite:///{config.DB_PATH}"
    url = config.DATABASE_URL
    for pfx in ("postgresql://", "postgres://"):
        if url.startswith(pfx):
            return "postgresql+psycopg2://" + url[len(pfx):]
    return url


engine = create_engine(_sa_url(), pool_pre_ping=True) if IS_PG else \
    create_engine(_sa_url())


def _qmark(sql: str) -> str:
    return sql.replace("?", "%s") if IS_PG else sql


class Row(dict):
    """Row supporting row[0] (position), row['col'] (name), and dict(row)."""
    def __getitem__(self, k):
        if isinstance(k, int):
            return list(self.values())[k]
        return super().__getitem__(k)


class _Result:
    def __init__(self, cursor):
        self._cur = cursor
        self._cols = [d[0] for d in cursor.description] if cursor.description else []

    def _wrap(self, tup):
        return Row(zip(self._cols, tup)) if tup is not None else None

    def fetchone(self):
        return self._wrap(self._cur.fetchone())

    def fetchall(self):
        return [self._wrap(t) for t in self._cur.fetchall()]

    def __iter__(self):
        return iter(self.fetchall())


_np_adapters_registered = False


def _register_np_adapters():
    """psycopg2 can't adapt numpy scalars (np.float64/int64/bool_) that pandas
    rows produce — it renders them literally into SQL (e.g. `np.float64(1.2)`),
    which Postgres reads as a schema ref and rejects. Register adapters once so
    numpy values from DataFrame rows store as plain numbers (NaN/Inf → NULL)."""
    global _np_adapters_registered
    if _np_adapters_registered:
        return
    import math
    import numpy as np
    from psycopg2.extensions import AsIs, register_adapter

    def _adapt_float(x):
        v = float(x)
        return AsIs("NULL") if (math.isnan(v) or math.isinf(v)) else AsIs(repr(v))

    register_adapter(np.float64, _adapt_float)
    register_adapter(np.float32, _adapt_float)
    for t in (np.int64, np.int32, np.int16, np.int8):
        register_adapter(t, lambda x: AsIs(int(x)))
    register_adapter(np.bool_, lambda x: AsIs(bool(x)))
    _np_adapters_registered = True


def _raw_connect():
    if IS_PG:
        import psycopg2
        _register_np_adapters()
        return psycopg2.connect(config.DATABASE_URL)
    conn = sqlite3.connect(config.DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


class _Conn:
    """sqlite3-style connection shim over sqlite3 or psycopg2."""
    def __init__(self):
        self._raw = _raw_connect()

    @property
    def raw(self):
        return self._raw

    def execute(self, sql: str, params: Sequence = ()):
        cur = self._raw.cursor()
        cur.execute(_qmark(sql), tuple(params))
        return _Result(cur)

    def executemany(self, sql: str, seq):
        cur = self._raw.cursor()
        cur.executemany(_qmark(sql), [tuple(p) for p in seq])
        return cur

    def executescript(self, script: str):
        # Both drivers execute a multi-statement string with comments natively.
        if IS_PG:
            self._raw.cursor().execute(script)
        else:
            self._raw.executescript(script)

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        try:
            self._raw.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        if exc_type is None:
            self._raw.commit()
        else:
            self._raw.rollback()
        self.close()


def connect(*_args, **_kwargs) -> _Conn:
    return _Conn()


def init_db(*_args, **_kwargs) -> None:
    """Create all tables if they do not exist (schema.sql works on both)."""
    with connect() as conn:
        conn.executescript(SCHEMA_PATH.read_text())
    print(f"Initialised database ({'postgres' if IS_PG else 'sqlite'})")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def upsert(conn: _Conn, table: str, rows: Sequence[Mapping]) -> int:
    """Insert-or-replace a batch of dict rows into `table`. Dialect-aware."""
    rows = list(rows)
    if not rows:
        return 0
    cols = list(rows[0].keys())
    collist = ",".join(f'"{c}"' for c in cols)
    ph = ",".join("?" for _ in cols)
    if IS_PG:
        pk = _PK.get(table)
        if pk:
            updates = ",".join(f'"{c}"=EXCLUDED."{c}"' for c in cols if c not in pk)
            conflict = ",".join(f'"{c}"' for c in pk)
            action = f"DO UPDATE SET {updates}" if updates else "DO NOTHING"
            sql = (f'INSERT INTO {table} ({collist}) VALUES ({ph}) '
                   f'ON CONFLICT ({conflict}) {action}')
        else:
            sql = f'INSERT INTO {table} ({collist}) VALUES ({ph})'
    else:
        sql = f'INSERT OR REPLACE INTO {table} ({collist}) VALUES ({ph})'
    conn.executemany(sql, [[r.get(c) for c in cols] for r in rows])
    conn.commit()
    return len(rows)


def read_df(sql: str, params: Sequence | None = None, *, parse_dates=None,
            conn: _Conn | None = None) -> pd.DataFrame:
    """Run a SELECT and return a DataFrame (works on SQLite and Postgres)."""
    close = conn is None
    conn = conn or connect()
    try:
        return pd.read_sql_query(_qmark(sql), conn.raw, params=params,
                                 parse_dates=parse_dates)
    finally:
        if close:
            conn.close()


def store_df(name: str, df: pd.DataFrame, if_exists: str = "replace") -> None:
    """Write a whole DataFrame as a table (snapshot tables). Uses the engine."""
    df.to_sql(name, engine, if_exists=if_exists, index=False)


def log_ingest(conn: _Conn, source: str, key: str, rows: int) -> None:
    upsert(conn, "ingest_log", [{
        "source": source, "key": key, "fetched_at": now_iso(), "rows": rows,
    }])


def already_fetched(conn: _Conn, source: str, key: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM ingest_log WHERE source=? AND key=?", (source, key))
    return cur.fetchone() is not None


def load_bars(conn: _Conn, symbols: Iterable[str] | None = None,
              start: str | None = None) -> pd.DataFrame:
    """Load daily bars as a tidy DataFrame (symbol, date, ohlcv)."""
    q = "SELECT symbol, date, open, high, low, close, volume FROM daily_bars"
    clauses, params = [], []
    if symbols:
        symbols = list(symbols)
        clauses.append(f"symbol IN ({','.join('?' for _ in symbols)})")
        params += symbols
    if start:
        clauses.append("date >= ?")
        params.append(start)
    if clauses:
        q += " WHERE " + " AND ".join(clauses)
    q += " ORDER BY symbol, date"
    return read_df(q, params or None, parse_dates=["date"], conn=conn)

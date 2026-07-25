"""DB access for the API. Reuses the dual-dialect reader in src/db/database.py
(SQLite for local dev, Postgres when DATABASE_URL is set). Defaults the local
DB to the trimmed universe snapshot the web contract is built against."""
from __future__ import annotations

import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
# Local dev: read the universe snapshot unless the caller overrides DB_PATH /
# provides a Postgres DATABASE_URL. Must be set before importing config/db.
if not os.getenv("DATABASE_URL"):
    os.environ.setdefault("DB_PATH", str(_ROOT / "data" / "screener_prod.db"))

import sys

if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import pandas as pd  # noqa: E402

from src.db import database as _db  # noqa: E402


def read_df(sql: str, params=None, **kw) -> pd.DataFrame:
    return _db.read_df(sql, params, **kw)


def clean_str(x) -> str | None:
    """Fix the em-dash mojibake stored in some *_label columns."""
    if x is None:
        return None
    return str(x).replace("�", "—").replace("\x96", "—").strip()


def title_case(name: str | None) -> str | None:
    """DB stores some names UPPERCASE; render them readably without wrecking
    tickers/acronyms."""
    if not name:
        return name
    if name.isupper():
        return name.title().replace("Inc.", "Inc.").replace(", Inc", ", Inc")
    return name

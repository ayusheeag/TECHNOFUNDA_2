"""Central configuration. Loads secrets from .env and defines project paths."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

load_dotenv(ROOT / ".env")

# --- API keys -------------------------------------------------------------
FMP_API_KEY = os.getenv("FMP_API_KEY", "")
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "")
EODHD_API_KEY = os.getenv("EODHD_API_KEY", "")
# Alpha Vantage -> free earnings-call transcripts (25 req/day). "demo" works
# only for IBM; get a free key (email only) for any other ticker.
ALPHAVANTAGE_API_KEY = os.getenv("ALPHAVANTAGE_API_KEY", "")

# Which provider supplies bulk daily bars: "polygon" | "eodhd"
PRICE_PROVIDER = os.getenv("PRICE_PROVIDER", "polygon").lower()

# --- Storage --------------------------------------------------------------
# Local dev defaults to SQLite. In production set DATABASE_URL to a Postgres
# DSN (Render sets this) and the data layer switches to Postgres automatically.
# DB_PATH can also be overridden to point SQLite at a mounted disk.
DATABASE_URL = os.getenv("DATABASE_URL", "")
DB_PATH = Path(os.getenv("DB_PATH", str(DATA_DIR / "screener.db")))

# --- Analysis parameters --------------------------------------------------
# Rolling windows (trading days)
EMA_LONG = 200          # long-term trend filter
EMA_MID = 50
SMA_LONG = 200
HIGH_52W = 252          # ~1 year of trading days
RS_LOOKBACK = 63        # ~3 months for relative strength

# Breadth thresholds that map to a position-sizing regime.
# Values are the % of the universe trading above its 200EMA.
REGIME_AGGRESSIVE = 60.0   # broad participation -> size up
REGIME_MODERATE = 40.0     # mixed -> normal size
# below REGIME_MODERATE -> shallow / defensive

# Minimum price & dollar-volume to keep a ticker in the tradable universe.
MIN_PRICE = 5.0
MIN_DOLLAR_VOL = 5_000_000  # 20-day avg $ volume


def require(key_name: str) -> str:
    """Return an API key or raise a helpful error if it is missing."""
    value = {
        "FMP_API_KEY": FMP_API_KEY,
        "POLYGON_API_KEY": POLYGON_API_KEY,
        "EODHD_API_KEY": EODHD_API_KEY,
        "ALPHAVANTAGE_API_KEY": ALPHAVANTAGE_API_KEY,
    }.get(key_name, "")
    if not value:
        raise RuntimeError(
            f"{key_name} is not set. Copy .env.example to .env and fill it in."
        )
    return value

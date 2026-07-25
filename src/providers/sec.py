"""Free bulk ticker -> company name resolution via SEC.

The SEC publishes company_tickers.json (all US filers, ticker + title) as a
single free file with no API key. We cache it locally so the earnings calendar
(and anything else) can attach company names without per-symbol API calls.

SEC fair-access policy asks for a descriptive User-Agent with contact info.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

from config import DATA_DIR

SEC_URL = "https://www.sec.gov/files/company_tickers.json"
CACHE = DATA_DIR / "company_names.json"
MAX_AGE_DAYS = 7
# Update the contact per SEC policy; a real e-mail is courteous, not required.
USER_AGENT = "TechnoFundaScreener/1.0 (contact: your-email@example.com)"


def _fetch() -> dict[str, str]:
    r = requests.get(SEC_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    r.raise_for_status()
    data = r.json()
    return {v["ticker"].upper(): v["title"] for v in data.values()}


def ticker_name_map(force: bool = False) -> dict[str, str]:
    """Return {TICKER: Company Name}, cached on disk for MAX_AGE_DAYS."""
    if not force and CACHE.exists():
        age_days = (time.time() - CACHE.stat().st_mtime) / 86400
        if age_days < MAX_AGE_DAYS:
            try:
                return json.loads(CACHE.read_text())
            except Exception:
                pass
    try:
        m = _fetch()
        CACHE.write_text(json.dumps(m))
        return m
    except Exception:
        # Fall back to a possibly-stale cache rather than failing outright.
        if CACHE.exists():
            try:
                return json.loads(CACHE.read_text())
            except Exception:
                return {}
        return {}


def resolve_names(symbols) -> dict[str, str]:
    """Map an iterable of symbols to names (unknown -> '')."""
    m = ticker_name_map()
    return {s: m.get(str(s).upper(), "") for s in symbols}

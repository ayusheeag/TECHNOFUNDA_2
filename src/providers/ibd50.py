"""IBD 50 constituent tags.

IBD (Investor's Business Daily) is a paid product with NO free official API.
The practical free proxy is the holdings of the IBD 50 ETF (ticker FFTY, the
"CapForce IBD 50 ETF"), which tracks the IBD 50 Index. `refresh()` pulls those
holdings from the issuer's public no-key JSON endpoint.

Caveat: FFTY holds ~50 names, rebalanced WEEKLY, tracking the IBD 50 Index --
a close but not identical proxy for the exact editorial, daily-ranked IBD 50
(which needs a paid IBD subscription). Good enough for tagging.

Cache file: data/ibd50.json  ->  {"as_of": "YYYY-MM-DD", "symbols": ["AMD", ...]}
You can also maintain it by hand (paste the weekly IBD 50 list) if you prefer.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import requests

from config import DATA_DIR

CACHE = DATA_DIR / "ibd50.json"

# CapForce IBD 50 ETF (FFTY) holdings, served from the issuer's HubDB store.
# No API key required. If this ever breaks, re-read the table id from the
# network calls on https://www.capforceetf.com/ffty/details .
FFTY_URL = "https://api.hubspot.com/cms/v3/hubdb/tables/1709801168/rows"
FFTY_PARAMS = {"portalId": "244514291", "fund_ticker": "FFTY", "limit": "1000"}


def ibd50_symbols() -> set[str]:
    """Return the current IBD 50 tickers (upper-cased). Empty set if no cache."""
    if not CACHE.exists():
        return set()
    try:
        data = json.loads(CACHE.read_text())
        return {s.upper() for s in data.get("symbols", [])}
    except Exception:
        return set()


def as_of() -> str | None:
    if not CACHE.exists():
        return None
    try:
        return json.loads(CACHE.read_text()).get("as_of")
    except Exception:
        return None


def save(symbols: list[str], as_of_date: str) -> int:
    """Persist a fetched/hand-entered IBD 50 list to the cache."""
    syms = sorted({s.strip().upper() for s in symbols if s.strip()})
    CACHE.write_text(json.dumps({"as_of": as_of_date, "symbols": syms}, indent=2))
    return len(syms)


def fetch_ffty_holdings() -> tuple[list[str], str]:
    """Return (tickers, as_of_date) from the FFTY ETF issuer holdings feed."""
    r = requests.get(FFTY_URL, params=FFTY_PARAMS,
                     headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    rows = r.json().get("results", [])
    syms, asof_ms = [], None
    for row in rows:
        v = row.get("values", {})
        t = v.get("holding_ticker")
        if t and t.upper() != "CASH&OTHER":
            syms.append(t.upper())
        asof_ms = asof_ms or v.get("as_of_date") or v.get("as_of")
    # as_of_date is epoch milliseconds; fall back to today.
    if isinstance(asof_ms, (int, float)):
        asof = datetime.fromtimestamp(asof_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    else:
        asof = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return syms, asof


def refresh() -> int:
    """Fetch the latest FFTY (IBD 50 proxy) holdings and cache them."""
    syms, asof = fetch_ffty_holdings()
    if not syms:
        raise RuntimeError("FFTY holdings feed returned no tickers.")
    return save(syms, asof)

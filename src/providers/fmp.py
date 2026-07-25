"""Financial Modeling Prep client -- 'stable' API.

FMP retired the legacy /api/v3/ endpoints on 2025-08-31; this client targets the
current /stable/ surface (symbol passed as a query param, not in the path).

Free-tier notes (what this project relies on):
  WORKS on free : profile, income-statement, ratios (annual), key-metrics
                  (annual), earnings-calendar, sector-pe-snapshot
  PAID only     : company-screener, stock-list, quarterly ratios/key-metrics,
                  earning-call-transcript
So fundamentals default to period="annual", and the universe is built from
per-symbol profiles (see ingest.fundamentals.ingest_universe_from_symbols)
rather than the paid screener.

Docs: https://site.financialmodelingprep.com/developer/docs/stable
"""
from __future__ import annotations

from typing import Any

from config import require
from src.providers.base import get_json

BASE = "https://financialmodelingprep.com/stable"


def _key() -> str:
    return require("FMP_API_KEY")


def profile(symbol: str) -> list[dict]:
    """Company profile incl. sector, industry, market cap, isEtf/isFund flags."""
    return get_json(f"{BASE}/profile", {"symbol": symbol, "apikey": _key()})


def income_statement(symbol: str, period: str = "annual", limit: int = 5) -> list[dict]:
    return get_json(f"{BASE}/income-statement",
                    {"symbol": symbol, "period": period, "limit": limit, "apikey": _key()})


def ratios(symbol: str, period: str = "annual", limit: int = 5) -> list[dict]:
    return get_json(f"{BASE}/ratios",
                    {"symbol": symbol, "period": period, "limit": limit, "apikey": _key()})


def key_metrics(symbol: str, period: str = "annual", limit: int = 5) -> list[dict]:
    return get_json(f"{BASE}/key-metrics",
                    {"symbol": symbol, "period": period, "limit": limit, "apikey": _key()})


def quote(symbol: str) -> list[dict]:
    """Light quote (price, name, 50/200-day avg, market cap). Free."""
    return get_json(f"{BASE}/quote", {"symbol": symbol, "apikey": _key()})


def ratios_ttm(symbol: str) -> list[dict]:
    """Trailing-twelve-month ratios incl. priceToEarningsRatioTTM. Free."""
    return get_json(f"{BASE}/ratios-ttm", {"symbol": symbol, "apikey": _key()})


def sector_pe(date: str, exchange: str | None = None,
              sector: str | None = None) -> list[dict]:
    """Sector P/E snapshot on a date -- input for the re-rating sector anchor."""
    params: dict[str, Any] = {"date": date, "apikey": _key()}
    if exchange:
        params["exchange"] = exchange
    if sector:
        params["sector"] = sector
    return get_json(f"{BASE}/sector-pe-snapshot", params)


def earnings_calendar(from_date: str, to_date: str) -> list[dict]:
    return get_json(f"{BASE}/earnings-calendar",
                    {"from": from_date, "to": to_date, "apikey": _key()})


def transcript(symbol: str, year: int, quarter: int) -> list[dict]:
    """Earnings-call transcript (PAID). Free keys get HTTP 402 here."""
    return get_json(f"{BASE}/earning-call-transcript",
                    {"symbol": symbol, "year": year, "quarter": quarter, "apikey": _key()})


def company_screener(**filters: Any) -> list[dict]:
    """Bulk screener (PAID). Free keys get HTTP 402. Kept for paid users."""
    return get_json(f"{BASE}/company-screener", {**filters, "apikey": _key()})

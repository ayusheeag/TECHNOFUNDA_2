"""Alpha Vantage client -- FREE earnings-call transcripts (concalls).

EARNINGS_CALL_TRANSCRIPT is on the free tier (25 requests/day). Coverage runs
from ~2010Q1 to present. Response shape:
    { "symbol": "IBM", "quarter": "2024Q1",
      "transcript": [ {"speaker","title","content","sentiment"}, ... ] }

Auth: apikey query param. Get a free key (email only) at
https://www.alphavantage.co/support/#api-key . The shared "demo" key only
serves IBM, so any other ticker needs your own key.

Docs: https://www.alphavantage.co/documentation/#earnings-call-transcript
"""
from __future__ import annotations

import config
from src.providers.base import ProviderError, get_json

BASE = "https://www.alphavantage.co/query"


def _key() -> str:
    # Fall back to the public demo key (IBM-only) when none is configured.
    return config.ALPHAVANTAGE_API_KEY or "demo"


def _quarter_str(year: int, quarter: int) -> str:
    return f"{year}Q{quarter}"


def earnings_transcript(symbol: str, year: int, quarter: int) -> dict:
    """Raw transcript payload for symbol + fiscal year/quarter.

    Raises ProviderError on Alpha Vantage throttle/limit/empty responses so
    callers can surface a clear message.
    """
    data = get_json(BASE, {
        "function": "EARNINGS_CALL_TRANSCRIPT",
        "symbol": symbol.upper(),
        "quarter": _quarter_str(year, quarter),
        "apikey": _key(),
    })
    if not isinstance(data, dict):
        raise ProviderError("Unexpected Alpha Vantage response")
    # AV signals limits/errors via these keys instead of an HTTP error code.
    for k in ("Note", "Information", "Error Message"):
        if k in data:
            msg = str(data[k])
            if "demo" in msg.lower() or "api key" in msg.lower():
                raise ProviderError(
                    "Alpha Vantage rejected this request. The 'demo' key only "
                    "works for IBM — add a free ALPHAVANTAGE_API_KEY to .env for "
                    "other tickers. (" + msg[:160] + ")")
            raise ProviderError("Alpha Vantage: " + msg[:200])
    if not data.get("transcript"):
        raise ProviderError(
            f"No transcript for {symbol} {_quarter_str(year, quarter)} "
            "(check the quarter exists / is ≥ 2010Q1).")
    return data


def transcript_text(payload: dict) -> str:
    """Flatten the segmented transcript into a single text blob."""
    return " ".join(seg.get("content", "") for seg in payload.get("transcript", []))


def transcript_date(payload: dict) -> str | None:
    """Alpha Vantage doesn't return a call date; use the quarter label."""
    return payload.get("quarter")

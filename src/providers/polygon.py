"""Polygon.io client -- bulk daily bars for the whole US market.

The 'grouped daily' endpoint returns OHLCV for EVERY US stock on one date in
a single request, which is exactly what breadth calculations need.

Docs: https://polygon.io/docs/stocks/get_v2_aggs_grouped_locale_us_market_stocks__date
"""
from __future__ import annotations

from config import require
from src.providers.base import get_json

BASE = "https://api.polygon.io"


def _key() -> str:
    return require("POLYGON_API_KEY")


FIN_URL = "https://api.polygon.io/vX/reference/financials"


def financials(ticker: str | None = None, *, timeframe: str = "annual",
               limit: int = 100, period_gte: str | None = None) -> dict:
    """Company financials (income/balance/cash-flow line items).

    Filter-optional: omit `ticker` to sweep the whole US market page by page
    (follow the returned 'next_url'). Returns {results, next_url?}.
    """
    params: dict = {"timeframe": timeframe, "limit": limit,
                    "order": "desc", "sort": "period_of_report_date",
                    "apikey": _key()}
    if ticker:
        params["ticker"] = ticker
    if period_gte:
        params["period_of_report_date.gte"] = period_gte
    return get_json(FIN_URL, params)


def financials_next(next_url: str) -> dict:
    """Fetch the next page of a financials sweep (next_url needs the apikey)."""
    return get_json(next_url, {"apikey": _key()})


def news(ticker: str, limit: int = 10) -> list[dict]:
    """Latest news articles for a ticker (title, publisher, url, published_utc)."""
    data = get_json(f"{BASE}/v2/reference/news",
                    {"ticker": ticker.upper(), "limit": limit,
                     "order": "desc", "sort": "published_utc", "apikey": _key()})
    return data.get("results", []) if isinstance(data, dict) else []


def _v(section: dict, key: str):
    x = section.get(key)
    return x.get("value") if isinstance(x, dict) else None


def parse_financials(result: dict) -> dict:
    """Flatten one financials result into the raw fields a screener needs."""
    f = result.get("financials", {})
    inc, bs, cf = (f.get("income_statement", {}), f.get("balance_sheet", {}),
                   f.get("cash_flow_statement", {}))
    tickers = result.get("tickers") or []
    return {
        "ticker": tickers[0] if tickers else None,
        "company_name": result.get("company_name"),
        "sic": result.get("sic"),
        "fiscal_year": result.get("fiscal_year"),
        "report_date": result.get("end_date"),
        "revenue": _v(inc, "revenues"),
        "net_income": _v(inc, "net_income_loss"),
        "gross_profit": _v(inc, "gross_profit"),
        "operating_income": _v(inc, "operating_income_loss"),
        "eps": _v(inc, "diluted_earnings_per_share"),
        "diluted_shares": _v(inc, "diluted_average_shares"),
        "equity": _v(bs, "equity"),
        "current_assets": _v(bs, "current_assets"),
        "current_liabilities": _v(bs, "current_liabilities"),
        "long_term_debt": _v(bs, "long_term_debt"),
        "op_cash_flow": _v(cf, "net_cash_flow_from_operating_activities"),
    }


def grouped_daily(date: str, adjusted: bool = True) -> list[dict]:
    """All US stock bars for a single date (YYYY-MM-DD).

    Returns a list of dicts with keys:
      T=ticker, o/h/l/c=OHLC, v=volume, n=trades
    """
    url = f"{BASE}/v2/aggs/grouped/locale/us/market/stocks/{date}"
    data = get_json(url, {"adjusted": str(adjusted).lower(), "apikey": _key()})
    return data.get("results", []) if isinstance(data, dict) else []


def daily_bars(symbol: str, start: str, end: str, adjusted: bool = True) -> list[dict]:
    """Historical daily bars for one symbol between start and end (YYYY-MM-DD)."""
    url = f"{BASE}/v2/aggs/ticker/{symbol}/range/1/day/{start}/{end}"
    data = get_json(url, {"adjusted": str(adjusted).lower(),
                          "sort": "asc", "limit": 50000, "apikey": _key()})
    return data.get("results", []) if isinstance(data, dict) else []


def to_bar_rows(results: list[dict], symbol: str | None = None) -> list[dict]:
    """Normalise Polygon aggregate results into our daily_bars schema rows."""
    import pandas as pd

    rows = []
    for r in results:
        ts = r.get("t")
        date = pd.to_datetime(ts, unit="ms").strftime("%Y-%m-%d") if ts else None
        rows.append({
            "symbol": symbol or r.get("T"),
            "date": date,
            "open": r.get("o"),
            "high": r.get("h"),
            "low": r.get("l"),
            "close": r.get("c"),
            "volume": r.get("v"),
        })
    return rows

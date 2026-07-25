"""Per-company financial history for the stock detail page.

Pulls annual + quarterly financials from Polygon and derives:
  - revenue and its growth rate (YoY)
  - reported diluted EPS
  - EPS EXCLUDING extraordinary items = income from CONTINUING operations
    (after tax) / diluted shares -- strips one-off discontinued-ops / special
    items -- and its growth rate.
"""
from __future__ import annotations

import pandas as pd

from src.providers import polygon as pg


def _v(section: dict, key: str):
    x = section.get(key)
    return x.get("value") if isinstance(x, dict) else None


def _rows(results: list[dict]) -> pd.DataFrame:
    out = []
    for r in results:
        f = r.get("financials", {})
        inc = f.get("income_statement", {})
        shares = _v(inc, "diluted_average_shares")
        cont = _v(inc, "income_loss_from_continuing_operations_after_tax")
        ni = _v(inc, "net_income_loss")
        # Continuing-operations earnings = excludes discontinued/extraordinary.
        clean_earnings = cont if cont is not None else ni
        eps_rep = _v(inc, "diluted_earnings_per_share")
        # Per-share ex-extra EPS, guarded against bad share counts (unit errors).
        eps_ex = (clean_earnings / shares) if (clean_earnings is not None
                                               and shares and shares > 1e7) else None
        out.append({
            "period": f'{r.get("fiscal_period", "")} {r.get("fiscal_year", "")}'.strip(),
            "report_date": r.get("end_date"),
            "revenue": _v(inc, "revenues"),
            "net_income": ni,
            "clean_earnings": clean_earnings,      # continuing ops, ex-extraordinary
            "eps_reported": eps_rep,
            "eps_ex_extra": round(eps_ex, 2) if eps_ex is not None else None,
            "gross_profit": _v(inc, "gross_profit"),
            "operating_income": _v(inc, "operating_income_loss"),
        })
    df = pd.DataFrame(out)
    if not df.empty:
        df = df.sort_values("report_date").reset_index(drop=True)
    return df


def _growth(df: pd.DataFrame, col: str, lag: int) -> pd.Series:
    prev = df[col].shift(lag)
    # Growth is meaningless when the base is <= 0 (loss -> profit etc.).
    g = 100 * (df[col] / prev - 1)
    g[prev <= 0] = pd.NA
    return g.round(2)


def financial_history(ticker: str, *, annual_limit: int = 6,
                      quarterly_limit: int = 12) -> dict:
    """Return {'annual': df, 'quarterly': df} with revenue + earnings growth.

    Growth is YoY (lag 1 annual, lag 4 quarterly). EPS growth is computed from
    CONTINUING-OPERATIONS earnings (split-immune and ex-extraordinary), because
    per-share EPS is distorted by stock splits in as-reported data. Each frame
    is sorted oldest -> newest.
    """
    out = {}
    for tf, lim, lag, key in [("annual", annual_limit, 1, "annual"),
                              ("quarterly", quarterly_limit, 4, "quarterly")]:
        try:
            res = pg.financials(ticker=ticker, timeframe=tf, limit=lim).get("results", [])
        except Exception:
            res = []
        df = _rows(res)
        if not df.empty:
            df["revenue_growth"] = _growth(df, "revenue", lag)
            df["eps_growth_ex_extra"] = _growth(df, "clean_earnings", lag)
        out[key] = df
    return out


def latest_growth(hist: dict) -> dict:
    """Headline latest revenue + EPS(ex-extra) growth from the annual frame."""
    a = hist.get("annual", pd.DataFrame())
    if a.empty:
        return {}
    last = a.iloc[-1]
    return {
        "period": last["period"],
        "revenue_growth": last.get("revenue_growth"),
        "eps_growth_ex_extra": last.get("eps_growth_ex_extra"),
        "eps_ex_extra": last.get("eps_ex_extra"),
        "eps_reported": last.get("eps_reported"),
    }

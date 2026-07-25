"""Re-rating analysis.

A stock 're-rates' when the market pays a higher multiple for the same
earnings/cash flow -- usually because growth is accelerating or perceived risk
falls. This module compares a stock's CURRENT valuation against two anchors:

  1. its OWN history  -- where does today's P/E (and EV/EBITDA) sit in the
     stock's trailing range? A low percentile + improving growth = room to
     re-rate up.
  2. its SECTOR       -- is it at a discount or premium to peers' median P/E?

It never says "buy"; it flags where a re-rating is *possible* so you can dig in.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _percentile_of_last(series: pd.Series) -> float | None:
    """Percentile rank (0-100) of the most recent value within its own history."""
    s = series.dropna()
    if len(s) < 4:
        return None
    last = s.iloc[-1]
    return round(100 * (s <= last).mean(), 1)


def _slope(series: pd.Series) -> float | None:
    """Sign/magnitude of a simple linear trend over the series (per period)."""
    s = series.dropna()
    if len(s) < 3:
        return None
    x = np.arange(len(s))
    return round(float(np.polyfit(x, s.values, 1)[0]), 3)


def valuation_history(fundamentals: pd.DataFrame, symbol: str) -> pd.DataFrame:
    """Chronological P/E, EV/EBITDA and revenue-growth for one symbol."""
    df = (fundamentals[fundamentals["symbol"] == symbol]
          .sort_values("report_date"))
    return df[["period", "report_date", "pe", "ev_ebitda", "revenue_yoy"]]


def rerating_scorecard(fundamentals: pd.DataFrame,
                       tickers: pd.DataFrame) -> pd.DataFrame:
    """Per-symbol re-rating scorecard.

    Columns:
      pe_now, pe_median (own history), pe_pctile (where now sits, 0-100 low=cheap)
      ev_now, ev_median
      sector_pe_median, pe_vs_sector (%, negative = discount to peers)
      rev_growth_now, rev_growth_slope (accelerating if > 0)
      rerating_setup  -> True when cheap-vs-self AND cheap-or-inline-vs-sector
                          AND growth accelerating (classic re-rating candidate)
    """
    fundamentals = fundamentals.sort_values("report_date")

    # Sector median P/E from the latest fundamentals per symbol (peer anchor).
    latest = fundamentals.groupby("symbol").tail(1).merge(
        tickers[["symbol", "sector", "industry", "name"]], on="symbol", how="left")
    sector_pe = (latest[latest["pe"] > 0]
                 .groupby("sector")["pe"].median()
                 .rename("sector_pe_median"))

    rows = []
    for sym, g in fundamentals.groupby("symbol"):
        g = g.sort_values("report_date")
        pe_now = g["pe"].dropna().iloc[-1] if g["pe"].notna().any() else None
        ev_now = g["ev_ebitda"].dropna().iloc[-1] if g["ev_ebitda"].notna().any() else None
        rows.append({
            "symbol": sym,
            "pe_now": round(pe_now, 1) if pe_now is not None else None,
            "pe_median": round(g["pe"].median(), 1) if g["pe"].notna().any() else None,
            "pe_pctile": _percentile_of_last(g["pe"]),
            "ev_now": round(ev_now, 1) if ev_now is not None else None,
            "ev_median": round(g["ev_ebitda"].median(), 1) if g["ev_ebitda"].notna().any() else None,
            "rev_growth_now": g["revenue_yoy"].dropna().iloc[-1] if g["revenue_yoy"].notna().any() else None,
            "rev_growth_slope": _slope(g["revenue_yoy"]),
        })
    out = pd.DataFrame(rows).merge(
        tickers[["symbol", "name", "sector", "industry"]], on="symbol", how="left")
    out = out.merge(sector_pe, on="sector", how="left")

    # Discount/premium to sector (negative = cheaper than peers).
    out["pe_vs_sector"] = np.where(
        out["sector_pe_median"].notna() & out["pe_now"].notna() & (out["sector_pe_median"] != 0),
        (100 * (out["pe_now"] / out["sector_pe_median"] - 1)).round(1),
        np.nan,
    )

    out["rerating_setup"] = (
        (out["pe_pctile"].fillna(100) <= 50)               # cheap vs own history
        & (out["pe_vs_sector"].fillna(999) <= 10)          # not expensive vs peers
        & (out["rev_growth_slope"].fillna(-1) > 0)         # growth accelerating
        & (out["rev_growth_now"].fillna(-999) > 0)         # still growing
    )

    cols = ["symbol", "name", "sector", "industry", "pe_now", "pe_median",
            "pe_pctile", "sector_pe_median", "pe_vs_sector", "ev_now", "ev_median",
            "rev_growth_now", "rev_growth_slope", "rerating_setup"]
    return out[cols].sort_values(["rerating_setup", "pe_pctile"],
                                 ascending=[False, True])

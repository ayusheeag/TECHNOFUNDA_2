"""Sector / industry technofunda scoring.

Combines a technical read on sector ETFs with fundamental growth to rank
sectors and surface 'technically sound but not stretched' groups.

Theme-age heuristic: a sector whose price has been extended above its 200EMA
for many months is 'late'; newly re-crossing groups are 'developing'. There is
no API field for theme age, so we approximate it from how long price has held
above the long-term trend.
"""
from __future__ import annotations

import pandas as pd

import config
from src.analysis.indicators import add_indicators

# Sector -> representative ETF proxy for technicals.
SECTOR_ETFS = {
    "Technology": "XLK",
    "Financial Services": "XLF",
    "Health Care": "XLV",
    "Energy": "XLE",
    "Industrials": "XLI",
    "Consumer Discretionary": "XLY",
    "Consumer Staples": "XLP",
    "Materials": "XLB",
    "Utilities": "XLU",
    "Real Estate": "XLRE",
    "Communication Services": "XLC",
}


def months_above_trend(close: pd.Series, ema_long: pd.Series) -> float:
    """Approximate consecutive months price has held above its 200EMA."""
    above = (close > ema_long)
    streak = 0
    for val in reversed(above.tolist()):
        if val:
            streak += 1
        else:
            break
    return round(streak / 21, 1)  # ~21 trading days per month


def score_sector_etfs(bars: pd.DataFrame) -> pd.DataFrame:
    """Given daily bars for the sector ETFs, produce a technical scorecard."""
    df = add_indicators(bars, ema_long=config.EMA_LONG, ema_mid=config.EMA_MID)
    rows = []
    for sym, g in df.groupby("symbol"):
        g = g.sort_values("date")
        last = g.iloc[-1]
        rows.append({
            "etf": sym,
            "close": round(last["close"], 2),
            "above_200ema": bool(last["above_ema_long"]),
            "above_50ema": bool(last["above_ema_mid"]),
            "rsi14": round(last["rsi14"], 1) if pd.notna(last["rsi14"]) else None,
            "pct_from_52w_high": round(100 * (last["close"] / last["hi_52w"] - 1), 1)
            if pd.notna(last["hi_52w"]) else None,
            "months_above_trend": months_above_trend(g["close"], g["ema_long"]),
        })
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    # "Sound but not stretched": above trend, RSI not overbought, theme young.
    out["sound_not_stretched"] = (
        out["above_200ema"]
        & (out["rsi14"].fillna(100) < 70)
        & (out["months_above_trend"] <= 18)
    )
    etf_to_sector = {v: k for k, v in SECTOR_ETFS.items()}
    out["sector"] = out["etf"].map(etf_to_sector)
    # Sort by RSI (strongest momentum first); NaN RSI sinks to the bottom.
    return out.sort_values("rsi14", ascending=False, na_position="last")


def stock_technicals_by_sector(bars: pd.DataFrame, tickers: pd.DataFrame,
                               ibd50: set[str] | None = None) -> pd.DataFrame:
    """Latest technical state per universe stock, tagged with sector/industry.

    Used to expand a sector into its constituent stocks. Only the classified
    universe (symbols in `tickers`) is computed, so this stays fast.
    """
    from src.analysis.screener import technical_snapshot

    universe = set(tickers["symbol"].dropna())
    snap = technical_snapshot(bars, symbols=universe)
    out = snap.merge(tickers[["symbol", "name", "sector", "industry"]],
                     on="symbol", how="left")
    ibd50 = ibd50 or set()
    out["ibd50"] = out["symbol"].str.upper().isin({s.upper() for s in ibd50})
    cols = ["symbol", "name", "sector", "industry", "ibd50", "close",
            "rsi14", "above_ema_long", "above_ema_mid", "at_52w_high"]
    out = out[[c for c in cols if c in out.columns]]
    return out.sort_values("rsi14", ascending=False, na_position="last")


def industry_growth(fundamentals: pd.DataFrame, tickers: pd.DataFrame) -> pd.DataFrame:
    """Median revenue YoY growth by industry -> ranks high-growth industries."""
    merged = fundamentals.merge(tickers[["symbol", "industry", "sector"]],
                                on="symbol", how="left")
    grp = (merged.groupby("industry")["revenue_yoy"]
           .median().reset_index()
           .rename(columns={"revenue_yoy": "median_rev_growth"}))
    return grp.sort_values("median_rev_growth", ascending=False)

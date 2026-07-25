"""Bottom-up stock screen: technofunda filter within chosen industries.

Pulls together the technical state (from bars) and fundamentals (balance-sheet
strength + revenue growth) to produce a ranked candidate list. Valuation is
shown for context but never used to exclude -- the user decides on price.
"""
from __future__ import annotations

import pandas as pd

import config
from src.analysis.indicators import add_indicators


def technical_snapshot(bars: pd.DataFrame,
                       symbols: set[str] | list[str] | None = None) -> pd.DataFrame:
    """Latest-bar technical state per symbol.

    If `symbols` is given, only those are processed -- important for speed:
    computing indicators over the whole market (100k+ bars) when the screen
    only needs a small universe is wasteful.
    """
    if symbols is not None:
        bars = bars[bars["symbol"].isin(set(symbols))]
    df = add_indicators(bars, ema_long=config.EMA_LONG, ema_mid=config.EMA_MID,
                        high_window=config.HIGH_52W)
    latest = df.sort_values("date").groupby("symbol").tail(1)
    return latest[[
        "symbol", "close", "ema_long", "ema_mid", "rsi14", "hi_52w",
        "above_ema_long", "above_ema_mid", "at_52w_high", "adv_dollar_vol",
    ]]


def rs_line_new_high(sym_bars: pd.DataFrame, bench_close: pd.Series,
                     *, lookback: int = 252, tol: float = 0.02) -> tuple[float | None, bool]:
    """Relative-strength line vs a benchmark, and whether it's at a new high.

    RS line = stock close / benchmark close (date-aligned). A new high in the RS
    line -- especially before price makes a new high -- flags leadership.
    Returns (rs_value, at_new_high). `tol` allows "within 2% of the RS high".
    """
    sym = sym_bars.sort_values("date").set_index("date")["close"]
    rs = (pd.to_numeric(sym, errors="coerce") / bench_close).dropna()
    if len(rs) < 5:
        return None, False
    cur = float(rs.iloc[-1])
    hi = float(rs.iloc[-lookback:].max())
    return round(cur, 4), bool(cur >= hi * (1 - tol))


def screen(bars: pd.DataFrame, fundamentals: pd.DataFrame, tickers: pd.DataFrame,
           *, industries: list[str] | None = None,
           min_rev_growth: float = 10.0,
           max_debt_to_equity: float = 1.0,
           min_current_ratio: float = 1.2,
           benchmark_bars: pd.DataFrame | None = None) -> pd.DataFrame:
    """Return ranked candidates passing the technofunda filter.

    Filters:
      - in one of `industries` (if given)
      - price above 200EMA and 50EMA (technically sound)
      - revenue YoY growth >= min_rev_growth
      - balance sheet: debt/equity <= max, current ratio >= min
    """
    # Only compute technicals for symbols we can actually screen (those with
    # fundamentals) -- avoids grinding indicators over the whole market.
    fund = (fundamentals.sort_values("report_date")
            .groupby("symbol").tail(1))
    tech = technical_snapshot(bars, symbols=set(fund["symbol"]))

    df = (tech.merge(fund, on="symbol", how="inner")
              .merge(tickers[["symbol", "name", "sector", "industry", "market_cap"]],
                     on="symbol", how="left"))

    if industries:
        df = df[df["industry"].isin(industries)]

    mask = (
        df["above_ema_long"]
        & df["above_ema_mid"]
        & (df["revenue_yoy"].fillna(-999) >= min_rev_growth)
        & (df["debt_to_equity"].fillna(999) <= max_debt_to_equity)
        & (df["current_ratio"].fillna(0) >= min_current_ratio)
        & (df["close"] >= config.MIN_PRICE)
        & (df["adv_dollar_vol"].fillna(0) >= config.MIN_DOLLAR_VOL)
    )
    out = df[mask].copy()

    # RS line vs benchmark (S&P 500 / SPY) + new-high flag -- vectorised over
    # the candidate set in one groupby (scales to a large universe).
    if benchmark_bars is not None and not benchmark_bars.empty and not out.empty:
        bench = (benchmark_bars.sort_values("date")
                 .set_index("date")["close"].astype(float))
        cand = set(out["symbol"])
        rb = bars[bars["symbol"].isin(cand)][["symbol", "date", "close"]].copy()
        rb["bench"] = rb["date"].map(bench)
        rb = rb.dropna(subset=["bench"]).sort_values(["symbol", "date"])
        rb["rs"] = rb["close"] / rb["bench"]
        rb["rs_hi"] = (rb.groupby("symbol", sort=False)["rs"]
                       .rolling(config.HIGH_52W, min_periods=5).max()
                       .reset_index(level=0, drop=True))
        last = rb.groupby("symbol", sort=False).tail(1)
        out["rs_line"] = out["symbol"].map(dict(zip(last["symbol"], last["rs"].round(4))))
        out["rs_new_high"] = out["symbol"].map(
            dict(zip(last["symbol"], last["rs"] >= last["rs_hi"] * 0.98)))

    # Simple composite rank: growth + trend proximity to highs, liquidity tie-break.
    out["pct_below_high"] = 100 * (1 - out["close"] / out["hi_52w"])
    out["score"] = (
        out["revenue_yoy"].fillna(0)
        - out["pct_below_high"].fillna(50) * 0.5
        + out.get("rs_new_high", pd.Series(False, index=out.index)).astype(int) * 10
    )
    cols = [
        "symbol", "name", "sector", "industry", "close", "revenue_yoy",
        "debt_to_equity", "current_ratio", "roe", "fcf", "pe", "ev_ebitda",
        "rsi14", "rs_line", "rs_new_high", "at_52w_high", "pct_below_high", "score",
    ]
    cols = [c for c in cols if c in out.columns]
    return out[cols].sort_values("score", ascending=False)

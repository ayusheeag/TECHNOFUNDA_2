"""Market breadth: the health check that drives position sizing.

Computes, for each date:
  - % of the universe trading above its 200EMA (and 50EMA)
  - count of new 52-week highs / lows
  - advancers vs decliners
Then classifies each date into a position-sizing regime.

Two compute paths:
  compute_breadth(bars)                -- full recompute over all history.
  incremental_breadth(window, state..) -- compute only NEW dates by CONTINUING
                                          each symbol's stored EMA. Exact (an
                                          adjust=False EWM is a simple recursion
                                          y[t]=y[t-1]+alpha*(x[t]-y[t-1])), so it
                                          matches a full recompute while loading
                                          only a trailing window.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import config

A_LONG = 2.0 / (config.EMA_LONG + 1)     # EWM alpha for the 200EMA (adjust=False)
A_MID = 2.0 / (config.EMA_MID + 1)       # ... and the 50EMA

_OUT_COLS = ["date", "universe_size", "pct_above_200ema", "pct_above_50ema",
             "new_52w_highs", "new_52w_lows", "advancers", "decliners", "regime"]


def classify_regime(pct_above_200ema: float) -> str:
    """Map breadth to a position-sizing posture.

    aggressive -> broad uptrend, size up
    moderate   -> mixed tape, normal size
    shallow    -> weak/defensive, smallest size or cash
    """
    if pct_above_200ema >= config.REGIME_AGGRESSIVE:
        return "aggressive"
    if pct_above_200ema >= config.REGIME_MODERATE:
        return "moderate"
    return "shallow"


def _flat(s: pd.Series) -> pd.Series:
    """Drop the group level added by groupby.ewm/rolling."""
    return s.reset_index(level=0, drop=True)


def _indicator_cols(bars: pd.DataFrame) -> pd.DataFrame:
    """Add ema_long/ema_mid/hi/lo/prev/adv_dollar_vol over full per-symbol history."""
    df = bars.sort_values(["symbol", "date"]).reset_index(drop=True)
    gc = df.groupby("symbol", sort=False)["close"]
    df["ema_long"] = _flat(gc.ewm(span=config.EMA_LONG, adjust=False).mean())
    df["ema_mid"] = _flat(gc.ewm(span=config.EMA_MID, adjust=False).mean())
    df["hi"] = _flat(gc.rolling(config.HIGH_52W).max())
    df["lo"] = _flat(gc.rolling(config.HIGH_52W).min())
    df["prev"] = gc.shift(1)
    df["dollar_vol"] = df["close"] * df["volume"]
    df["adv_dollar_vol"] = _flat(
        df.groupby("symbol", sort=False)["dollar_vol"].rolling(20).mean())
    return df


def _aggregate(df: pd.DataFrame, min_price: float) -> pd.DataFrame:
    """Filter to the tradable universe, flag, and aggregate per date."""
    df = df[(df["close"] >= min_price) &
            (df["adv_dollar_vol"] >= config.MIN_DOLLAR_VOL)].copy()
    df["valid_long"] = df["ema_long"].notna()
    df["above_long"] = (df["close"] > df["ema_long"]) & df["valid_long"]
    df["above_mid"] = df["close"] > df["ema_mid"]
    df["at_hi"] = df["close"] >= df["hi"] * 0.98
    df["at_lo"] = df["close"] <= df["lo"] * 1.02
    chg = df["close"] / df["prev"] - 1
    df["adv"] = chg > 0
    df["dec"] = chg < 0

    grp = df.groupby("date").agg(
        n_all=("close", "size"),
        universe_size=("valid_long", "sum"),
        above_long_cnt=("above_long", "sum"),
        above_mid_cnt=("above_mid", "sum"),
        new_52w_highs=("at_hi", "sum"),
        new_52w_lows=("at_lo", "sum"),
        advancers=("adv", "sum"),
        decliners=("dec", "sum"),
    ).reset_index()

    us = grp["universe_size"].replace(0, np.nan)
    grp["pct_above_200ema"] = (100 * grp["above_long_cnt"] / us).round(2)
    grp["pct_above_50ema"] = (100 * grp["above_mid_cnt"] / grp["n_all"]).round(2)
    grp["date"] = pd.to_datetime(grp["date"]).dt.strftime("%Y-%m-%d")
    grp["regime"] = grp["pct_above_200ema"].apply(
        lambda x: classify_regime(x) if pd.notna(x) else None)
    return grp[_OUT_COLS]


def _state_from(df: pd.DataFrame) -> pd.DataFrame:
    """Latest per-symbol EMA state (for incremental continuation)."""
    last = df.groupby("symbol", sort=False).tail(1)
    return last[["symbol", "date", "ema_long", "ema_mid"]].rename(
        columns={"date": "last_date", "ema_long": "ema200", "ema_mid": "ema50"})


def compute_breadth(bars: pd.DataFrame, *, min_price: float | None = None,
                    return_state: bool = False):
    """Full breadth recompute over all history (vectorised)."""
    min_price = config.MIN_PRICE if min_price is None else min_price
    df = _indicator_cols(bars)
    out = _aggregate(df, min_price)
    if return_state:
        return out, _state_from(df)
    return out


def incremental_breadth(window_bars: pd.DataFrame, prev_state: pd.DataFrame,
                        new_dates: list[str], *, min_price: float | None = None):
    """Breadth for `new_dates` only, continuing EMAs from `prev_state`.

    window_bars must cover at least HIGH_52W trading days before new_dates[0]
    (for the 52-week rolling high/low) through new_dates[-1]. Returns
    (breadth_rows_df, new_state_df).
    """
    min_price = config.MIN_PRICE if min_price is None else min_price
    w = window_bars.sort_values(["symbol", "date"]).reset_index(drop=True)
    gc = w.groupby("symbol", sort=False)["close"]
    w["hi"] = _flat(gc.rolling(config.HIGH_52W).max())
    w["lo"] = _flat(gc.rolling(config.HIGH_52W).min())
    w["prev"] = gc.shift(1)
    w["dollar_vol"] = w["close"] * w["volume"]
    w["adv_dollar_vol"] = _flat(
        w.groupby("symbol", sort=False)["dollar_vol"].rolling(20).mean())

    ema200 = prev_state.set_index("symbol")["ema200"].astype(float)
    ema50 = prev_state.set_index("symbol")["ema50"].astype(float)

    pieces = []
    for d in sorted(new_dates):
        day = w[w["date"] == d].set_index("symbol")
        closes = day["close"]
        # Continue EMA; symbols with no prior state (new listings) start at close.
        e200 = ema200.reindex(closes.index)
        e50 = ema50.reindex(closes.index)
        e200 = e200.where(e200.notna(), closes)
        e50 = e50.where(e50.notna(), closes)
        e200 = e200 + A_LONG * (closes - e200)
        e50 = e50 + A_MID * (closes - e50)
        # Carry state forward (update today's symbols, keep the rest).
        ema200 = e200.combine_first(ema200)
        ema50 = e50.combine_first(ema50)
        piece = day.copy()
        piece["ema_long"] = e200
        piece["ema_mid"] = e50
        piece["date"] = d
        pieces.append(piece.reset_index())

    rows = _aggregate(pd.concat(pieces, ignore_index=True), min_price)
    state = pd.DataFrame({"symbol": ema200.index,
                          "ema200": ema200.values}).merge(
        pd.DataFrame({"symbol": ema50.index, "ema50": ema50.values}),
        on="symbol", how="outer")
    state["last_date"] = sorted(new_dates)[-1]
    return rows, state


def latest_regime(breadth_df: pd.DataFrame) -> dict:
    """Convenience: return the most recent breadth row as a dict."""
    if breadth_df.empty:
        return {}
    row = breadth_df.sort_values("date").iloc[-1]
    return row.to_dict()

"""Vectorised technical indicators computed on a tidy bars DataFrame.

Input frames are expected with columns: symbol, date, open, high, low, close, volume.
Each function returns per-symbol series aligned to the input index.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def ema(close: pd.Series, span: int) -> pd.Series:
    return close.ewm(span=span, adjust=False).mean()


def sma(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window).mean()


def rsi(close: pd.Series, window: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(window).mean()
    loss = -delta.clip(upper=0).rolling(window).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def rolling_high(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window).max()


def rolling_low(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window).min()


def _flat(s: pd.Series) -> pd.Series:
    """Drop the group level added by groupby.ewm/rolling."""
    return s.reset_index(level=0, drop=True)


def add_indicators(df: pd.DataFrame, *, ema_long: int = 200, ema_mid: int = 50,
                   high_window: int = 252) -> pd.DataFrame:
    """Add per-symbol indicator columns (vectorised with grouped ewm/rolling,
    so it scales to thousands of symbols)."""
    df = df.sort_values(["symbol", "date"]).reset_index(drop=True)
    gc = df.groupby("symbol", sort=False)["close"]
    df["ema_long"] = _flat(gc.ewm(span=ema_long, adjust=False).mean())
    df["ema_mid"] = _flat(gc.ewm(span=ema_mid, adjust=False).mean())
    df["hi_52w"] = _flat(gc.rolling(high_window).max())
    df["lo_52w"] = _flat(gc.rolling(high_window).min())

    # RSI, vectorised: grouped diff -> gains/losses -> grouped rolling means.
    delta = df.groupby("symbol", sort=False)["close"].diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = _flat(gain.groupby(df["symbol"], sort=False).rolling(14).mean())
    avg_loss = _flat(loss.groupby(df["symbol"], sort=False).rolling(14).mean())
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["rsi14"] = 100 - 100 / (1 + rs)

    df["above_ema_long"] = df["close"] > df["ema_long"]
    df["above_ema_mid"] = df["close"] > df["ema_mid"]
    # within 2% of the 52-week high counts as "at new highs"
    df["at_52w_high"] = df["close"] >= df["hi_52w"] * 0.98
    df["at_52w_low"] = df["close"] <= df["lo_52w"] * 1.02
    df["dollar_vol"] = df["close"] * df["volume"]
    df["adv_dollar_vol"] = _flat(
        df.groupby("symbol", sort=False)["dollar_vol"].rolling(20).mean())
    return df


def relative_strength(df: pd.DataFrame, benchmark_close: pd.Series,
                      lookback: int = 63) -> pd.DataFrame:
    """Price return over `lookback` vs a benchmark's return -> RS ratio.

    benchmark_close must be indexed by date.
    """
    df = df.sort_values(["symbol", "date"]).copy()
    g = df.groupby("symbol", group_keys=False)
    df["ret"] = g["close"].transform(lambda s: s.pct_change(lookback))
    bench_ret = benchmark_close.pct_change(lookback)
    df = df.merge(bench_ret.rename("bench_ret"), left_on="date",
                  right_index=True, how="left")
    df["rs_ratio"] = (1 + df["ret"]) / (1 + df["bench_ret"])
    return df

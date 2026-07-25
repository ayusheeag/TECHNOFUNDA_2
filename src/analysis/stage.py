"""Weinstein Stage Analysis.

Stan Weinstein's four stages, judged off a long moving average (the classic
30-week SMA = 150 trading days) and its slope:

  Stage 1  Basing / Accumulation  -- MA flat after a decline, price churning
           around it near the lows. "Get ready."
  Stage 2  Advancing / Markup     -- price above a RISING MA. The uptrend you
           want to own. "Buy."
  Stage 3  Topping / Distribution -- MA flattening after an advance, price
           choppy near the highs. "Take profits."
  Stage 4  Declining / Markdown   -- price below a FALLING MA. The downtrend to
           avoid. "Sell / stay away."

classify_stage() takes daily bars for ONE symbol and returns the stage plus the
sub-signals behind it, so the call is explainable rather than a black box.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

MA_WINDOW = 150       # 30 weeks
SLOPE_WINDOW = 20     # ~1 month, to measure MA direction
FLAT_PCT = 1.5        # |MA change| below this over SLOPE_WINDOW = "flat"
RANGE_WINDOW = 252    # 52 weeks for range position


def _rsi(close: pd.Series, window: int = 14) -> float | None:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(window).mean()
    loss = -delta.clip(upper=0).rolling(window).mean()
    rs = gain / loss.replace(0, np.nan)
    val = (100 - 100 / (1 + rs)).iloc[-1]
    return round(float(val), 1) if pd.notna(val) else None


STAGE_LABEL = {
    1: "Stage 1 — Basing / accumulation",
    2: "Stage 2 — Advancing / uptrend",
    3: "Stage 3 — Topping / distribution",
    4: "Stage 4 — Declining / downtrend",
}
STAGE_ACTION = {
    1: "Watchlist — wait for a Stage 2 breakout.",
    2: "Uptrend — the ownable stage.",
    3: "Distribution — tighten stops / take profits.",
    4: "Downtrend — avoid / stay away.",
}


def classify_stage(bars: pd.DataFrame, *, ma_window: int = MA_WINDOW) -> dict:
    """Classify one symbol's Weinstein stage from its daily bars.

    `bars` needs columns date, close (one symbol). Returns a dict with stage,
    label, action and the sub-signals; stage is None if history is too short.
    """
    s = bars.sort_values("date")
    close = pd.to_numeric(s["close"], errors="coerce").dropna().reset_index(drop=True)
    n = len(close)
    need = ma_window + SLOPE_WINDOW
    if n < need:
        return {"stage": None,
                "label": f"Insufficient history ({n}/{need} days needed)",
                "action": "Backfill more price history for a stage read."}

    ma = close.rolling(ma_window).mean()
    last = float(close.iloc[-1])
    ma_now = float(ma.iloc[-1])
    ma_prev = float(ma.iloc[-1 - SLOPE_WINDOW])
    slope_pct = (ma_now - ma_prev) / ma_prev * 100 if ma_prev else 0.0

    win = min(RANGE_WINDOW, n)
    hi = float(close.iloc[-win:].max())
    lo = float(close.iloc[-win:].min())
    range_pos = (last - lo) / (hi - lo) * 100 if hi > lo else 50.0

    above = last > ma_now
    rising = slope_pct > FLAT_PCT
    falling = slope_pct < -FLAT_PCT

    # Clear trending cases first, then resolve flat-MA into base (low) vs top (high).
    if above and rising:
        stage = 2
    elif (not above) and falling:
        stage = 4
    elif rising:                      # MA turning up (even if price just below)
        stage = 2 if above else 1     # above -> advancing; below -> late base
    elif falling:                     # MA rolling over
        stage = 4 if not above else 3
    else:                             # MA flat -> position in range decides
        if range_pos >= 50:
            stage = 3                 # near highs, flat MA -> topping
        else:
            stage = 1                 # near lows, flat MA -> basing

    return {
        "stage": stage,
        "label": STAGE_LABEL[stage],
        "action": STAGE_ACTION[stage],
        "close": round(last, 2),
        "ma150": round(ma_now, 2),
        "above_ma": above,
        "ma_slope_pct": round(slope_pct, 2),   # MA % change over ~1 month
        "range_pos": round(range_pos, 1),      # 0=52w low, 100=52w high
        "rsi14": _rsi(close),
        "days": n,
    }


def stage_snapshot(bars: pd.DataFrame, symbols=None,
                   ma_window: int = MA_WINDOW) -> pd.DataFrame:
    """Vectorised Weinstein stage for MANY symbols at once (latest bar each).

    Returns a DataFrame [symbol, stage, stage_label, close, ma150, ma_slope_pct,
    range_pos, above_ma]. Much faster than looping classify_stage over a large
    universe.
    """
    df = bars.sort_values(["symbol", "date"]).reset_index(drop=True)
    if symbols is not None:
        df = df[df["symbol"].isin(set(symbols))]
    if df.empty:
        return pd.DataFrame()

    gc = df.groupby("symbol", sort=False)["close"]
    df["ma"] = gc.rolling(ma_window).mean().reset_index(level=0, drop=True)
    df["ma_prev"] = df.groupby("symbol", sort=False)["ma"].shift(SLOPE_WINDOW)
    df["hi"] = gc.rolling(RANGE_WINDOW).max().reset_index(level=0, drop=True)
    df["lo"] = gc.rolling(RANGE_WINDOW).min().reset_index(level=0, drop=True)

    last = df.groupby("symbol", sort=False).tail(1).copy()
    last["ma_slope_pct"] = ((last["ma"] - last["ma_prev"]) /
                            last["ma_prev"].replace(0, np.nan) * 100)
    rng = (last["hi"] - last["lo"]).replace(0, np.nan)
    last["range_pos"] = ((last["close"] - last["lo"]) / rng * 100)
    last["above_ma"] = last["close"] > last["ma"]

    above = last["above_ma"].to_numpy()
    rising = (last["ma_slope_pct"] > FLAT_PCT).to_numpy()
    falling = (last["ma_slope_pct"] < -FLAT_PCT).to_numpy()
    rpos = last["range_pos"].fillna(50).to_numpy()
    stage = np.select(
        [above & rising, ~above & falling, rising, falling, rpos >= 50],
        [2, 4, 1, 3, 3], default=1).astype("float")
    stage[last["ma_prev"].isna().to_numpy()] = np.nan   # not enough history
    last["stage"] = stage
    last["stage_label"] = last["stage"].map(
        lambda s: STAGE_LABEL.get(int(s)) if pd.notna(s) else None)
    last["ma150"] = last["ma"].round(2)
    last["ma_slope_pct"] = last["ma_slope_pct"].round(2)
    last["range_pos"] = last["range_pos"].round(1)
    return last[["symbol", "stage", "stage_label", "close", "ma150",
                 "ma_slope_pct", "range_pos", "above_ma"]]


def stage_series(bars: pd.DataFrame, ma_window: int = MA_WINDOW) -> pd.DataFrame:
    """Return date-indexed close + 150MA for charting alongside the stage."""
    s = bars.sort_values("date").copy()
    s["close"] = pd.to_numeric(s["close"], errors="coerce")
    s["ma150"] = s["close"].rolling(ma_window).mean()
    s["date"] = pd.to_datetime(s["date"])
    return s.set_index("date")[["close", "ma150"]]

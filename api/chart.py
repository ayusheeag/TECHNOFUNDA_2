"""Chart payload compute — Python port of the web's analysis.ts (itself parity-
tested against stage.py). Turns daily OHLCV + the SPY benchmark into the full
StockChartResponse (bars + per-bar stage + RS + segments) the web chart draws.
The chart computes nothing client-side; the API delivers every series."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .interpret import STAGE_ACTION, STAGE_LABEL, STAGE_SHORT, STAGE_TONE, interp

MA_WINDOW = 150
SLOPE_WINDOW = 20
FLAT_PCT = 1.5
RANGE_WINDOW = 252
RSI_WINDOW = 14
RS_LOOKBACK = 252
RS_MIN_PERIODS = 5
RS_TOL = 0.02
STAGE_MIN_BARS = MA_WINDOW + SLOPE_WINDOW  # 170


def _r(x, d):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), d)


def rsi14_cutler(closes: np.ndarray):
    n = len(closes)
    if n < RSI_WINDOW + 1:
        return None
    d = np.diff(closes[n - RSI_WINDOW - 1:])
    gain = d[d > 0].sum() / RSI_WINDOW
    loss = -d[d < 0].sum() / RSI_WINDOW
    if loss == 0:
        return None
    return round(100 - 100 / (1 + gain / loss), 1)


def compute(symbol: str, bars: pd.DataFrame, bench: pd.DataFrame, market_phase: str, generated_at: str,
            *, ma_window: int = MA_WINDOW, slope_window: int = SLOPE_WINDOW, range_window: int = RANGE_WINDOW,
            timeframe: str = "1d") -> dict:
    """bars: [date, open, high, low, close, volume] for one symbol (any order).
    bench: [date, close] for the benchmark. Windows default to the daily
    Weinstein constants; pass 30/4/52 for a weekly chart."""
    b = bars.sort_values("date").reset_index(drop=True)
    dates = b["date"].astype(str).tolist()
    closes = pd.to_numeric(b["close"], errors="coerce").to_numpy(dtype=float)
    n = len(closes)

    ma = pd.Series(closes).rolling(ma_window).mean()
    ma_prev = ma.shift(slope_window)
    slope = (ma - ma_prev) / ma_prev.replace(0, np.nan) * 100
    hi = pd.Series(closes).rolling(range_window, min_periods=1).max()
    lo = pd.Series(closes).rolling(range_window, min_periods=1).min()
    span = (hi - lo).replace(0, np.nan)
    range_pos = ((closes - lo) / span * 100).fillna(50)
    above = closes > ma
    rising = slope > FLAT_PCT
    falling = slope < -FLAT_PCT

    # Scalar classify_stage ladder, vectorised (NOT the stage_snapshot np.select).
    stage = np.select(
        [above & rising, (~above) & falling, rising, falling, range_pos >= 50],
        [2, 4, 1, 3, 3],
        default=1,
    ).astype(float)
    valid = ma.notna().to_numpy() & ma_prev.notna().to_numpy()
    stage[~valid] = np.nan

    stage_bars = []
    for i in range(n):
        s = None if np.isnan(stage[i]) else int(stage[i])
        stage_bars.append({
            "date": dates[i],
            "stage": s,
            "aboveMa": bool(above.iloc[i]) if not np.isnan(ma.iloc[i]) else False,
            "maSlopePct": _r(slope.iloc[i], 6) if not np.isnan(slope.iloc[i]) else None,
            "rangePos": _r(range_pos.iloc[i], 6) if s is not None else None,
        })

    # RLE segments (drop null runs)
    segments = []
    cur = None
    for i, sb in enumerate(stage_bars):
        s = sb["stage"]
        if s is None:
            if cur:
                segments.append(cur)
                cur = None
            continue
        if cur and cur["stage"] == s:
            cur["endDate"] = sb["date"]
            cur["endIndex"] = i
        else:
            if cur:
                segments.append(cur)
            cur = {"stage": s, "startDate": sb["date"], "endDate": sb["date"], "startIndex": i, "endIndex": i}
    if cur:
        segments.append(cur)

    # RS vs benchmark, date-aligned
    bmap = dict(zip(bench["date"].astype(str), pd.to_numeric(bench["close"], errors="coerce")))
    rs_rows = []
    rs_vals = []
    for i in range(n):
        bp = bmap.get(dates[i])
        if bp is None or bp == 0 or np.isnan(bp):
            continue
        rsv = closes[i] / bp
        rs_vals.append((i, rsv))
    # rolling-252 min-periods-5 max over the rs sequence
    rs_arr = [v for _, v in rs_vals]
    for k, (i, rsv) in enumerate(rs_vals):
        rs_high = None
        new_high = False
        if k + 1 >= RS_MIN_PERIODS:
            lo0 = max(0, k - RS_LOOKBACK + 1)
            rs_high = max(rs_arr[lo0:k + 1])
            new_high = rsv >= rs_high * (1 - RS_TOL)
        rs_rows.append({"date": dates[i], "rs": round(rsv, 4), "rsHigh252": (None if rs_high is None else round(rs_high, 4)), "newHigh": bool(new_high)})

    rs_new_high = rs_rows[-1]["newHigh"] if rs_rows else False
    rs_new_high_from = None
    if rs_rows and rs_rows[-1]["newHigh"]:
        j = len(rs_rows) - 1
        while j > 0 and rs_rows[j - 1]["newHigh"]:
            j -= 1
        rs_new_high_from = rs_rows[j]["date"]

    last = n - 1
    lb = stage_bars[last]
    latest_stage = lb["stage"]
    ma150 = _r(ma.iloc[last], 2)
    close = round(float(closes[last]), 2)
    rsi = rsi14_cutler(closes)
    series = [{"date": dates[i], "close": round(float(closes[i]), 2), "ma150": _r(ma.iloc[i], 2)} for i in range(n)]
    ohlcv = [{
        "date": dates[i],
        "open": round(float(b["open"].iloc[i]), 2),
        "high": round(float(b["high"].iloc[i]), 2),
        "low": round(float(b["low"].iloc[i]), 2),
        "close": round(float(closes[i]), 2),
        "volume": int(b["volume"].iloc[i]) if not pd.isna(b["volume"].iloc[i]) else 0,
    } for i in range(n)]

    period = "weekly" if timeframe == "1w" else "daily"
    header = _header_interp(latest_stage, close, ma150, lb["maSlopePct"], rs_new_high, "SPY")
    aria = _aria_summary(symbol, n, latest_stage, close, ma150, lb["maSlopePct"], lb["rangePos"], rsi, rs_new_high, "SPY", dates[last], period)

    return {
        "symbol": symbol,
        "stage": latest_stage,
        "label": (STAGE_LABEL[latest_stage] if latest_stage else "Insufficient history"),
        "action": (STAGE_ACTION[latest_stage] if latest_stage else "Backfill more price history for a stage read."),
        "close": close,
        "ma150": ma150,
        "aboveMa": lb["aboveMa"],
        "maSlopePct": _r(lb["maSlopePct"], 2),
        "rangePos": _r(lb["rangePos"], 1),
        "rsi14": rsi,
        "days": n,
        "series": series,
        "interpretation": header,
        "ariaSummary": aria,
        "bars": ohlcv,
        "stageBars": stage_bars,
        "stageSegments": segments,
        "rs": rs_rows,
        "rsNewHigh": rs_new_high,
        "rsNewHighFrom": rs_new_high_from,
        "meta": {
            "source": "api",
            "generatedAt": generated_at,
            "benchmarkSymbol": "SPY",
            "marketPhase": market_phase,
            "stale": False,
            "currency": "USD",
            "firstDate": dates[0],
            "lastDate": dates[last],
            "timeframe": timeframe,
        },
    }


def compute_intraday(symbol: str, bars: pd.DataFrame, market_phase: str, generated_at: str, timeframe: str) -> dict:
    """Candles + volume only. The Weinstein stage / RS / 150-day MA are daily-
    to-weekly concepts, so intraday charts carry no bands, RS pane or MA line."""
    b = bars.sort_values("date").reset_index(drop=True)
    n = len(b)
    dates = b["date"].tolist()  # UNIX-SECONDS ints for intraday
    ohlcv = [{
        "date": int(dates[i]),
        "open": round(float(b["open"].iloc[i]), 2), "high": round(float(b["high"].iloc[i]), 2),
        "low": round(float(b["low"].iloc[i]), 2), "close": round(float(b["close"].iloc[i]), 2),
        "volume": int(b["volume"].iloc[i]) if not pd.isna(b["volume"].iloc[i]) else 0,
    } for i in range(n)]
    last_close = ohlcv[-1]["close"] if ohlcv else 0
    tf_label = {"15m": "15-minute", "1h": "hourly", "4h": "4-hour"}.get(timeframe, timeframe)
    return {
        "symbol": symbol, "stage": None, "label": f"{tf_label} intraday", "action": "Intraday view — stage analysis applies on the daily/weekly timeframe.",
        "close": last_close, "ma150": None, "aboveMa": False, "maSlopePct": None, "rangePos": None, "rsi14": None, "days": n,
        "series": [{"date": int(dates[i]), "close": ohlcv[i]["close"], "ma150": None} for i in range(n)],
        "interpretation": interp(f"{tf_label} candles", "neutral", "Intraday price action — Weinstein stage, RS and the 150-day average show on the daily and weekly timeframes."),
        "ariaSummary": f"{symbol} {tf_label} intraday chart, {n} bars. Stage analysis is shown on the daily and weekly timeframes.",
        "bars": ohlcv,
        "stageBars": [{"date": int(dates[i]), "stage": None, "aboveMa": False, "maSlopePct": None, "rangePos": None} for i in range(n)],
        "stageSegments": [], "rs": [], "rsNewHigh": False, "rsNewHighFrom": None,
        "meta": {"source": "api", "generatedAt": generated_at, "benchmarkSymbol": "SPY", "marketPhase": market_phase, "stale": False, "currency": "USD",
                 "firstDate": str(dates[0]) if n else "", "lastDate": str(dates[-1]) if n else "", "timeframe": timeframe},
    }


def _pct(x, digits=1):
    if x is None:
        return "—"
    s = "+" if x > 0 else "−" if x < 0 else ""
    return f"{s}{abs(x):.{digits}f}%"


def _ma_dir(slope):
    if slope is None:
        return "flat"
    return "rising" if slope > FLAT_PCT else "falling" if slope < -FLAT_PCT else "flat"


def _pct_vs_ma(close, ma150):
    return None if not ma150 else (close / ma150 - 1) * 100


def _header_interp(stage, close, ma150, slope, rs_new_high, bench):
    if stage is None:
        return interp("Not enough history for a stage read", "neutral", "Needs 170 daily sessions.")
    rel = _pct_vs_ma(close, ma150)
    side = "near" if rel is None else "above" if rel >= 0 else "below"
    rs_bit = f"relative strength vs {bench} is at a new high (leading)" if rs_new_high else f"relative strength vs {bench} is below its recent high"
    detail = f"Price is {_pct(rel)} {side} its {_ma_dir(slope)} 150-day average; {rs_bit}. {STAGE_ACTION[stage]}"
    return interp(STAGE_SHORT[stage], STAGE_TONE[stage], detail)


def _aria_summary(symbol, days, stage, close, ma150, slope, range_pos, rsi, rs_new_high, bench, last_date, period="daily"):
    if stage is None or days < STAGE_MIN_BARS:
        return f"{symbol} {period} chart, {days} sessions. Not enough history for a Weinstein stage read (needs 170)."
    rel = _pct_vs_ma(close, ma150)
    side = "near" if rel is None else "above" if rel >= 0 else "below"
    rs_bit = f"Relative strength versus {bench} is at a new high." if rs_new_high else f"Relative strength versus {bench} is below its recent high."
    rp = "—" if range_pos is None else round(range_pos)
    return (f"{symbol} {period}, {days} sessions ending {last_date}. Currently {STAGE_SHORT[stage]}. "
            f"Close {close:.2f}, {side} the 150-day average ({_pct(rel)}), which is {_ma_dir(slope)} {_pct(slope)} over the last month. "
            f"Range position {rp} of 100. RSI {rsi if rsi is not None else '—'}. {rs_bit}")

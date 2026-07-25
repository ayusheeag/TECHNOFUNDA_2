// PARITY CORE. Pure TypeScript port of the live Python analysis, constant-for-
// constant, so the mock provider's output equals the future FastAPI wire shape.
//
// Mirrors:
//   src/analysis/stage.py    → classify_stage (the SCALAR ladder), stage_series
//   src/analysis/screener.py → rs_line_new_high, rsi14 (Cutler/SMA)
//   src/analysis/indicators  → sma
//
// IMPORTANT — we mirror the SCALAR classify_stage ladder, NOT the vectorized
// stage_snapshot np.select([above&rising, ~above&falling, rising, falling,
// rpos>=50],[2,4,1,3,3]). That vectorized form is INCONSISTENT with the scalar
// one (it maps bare `rising`→1 and bare `falling`→3 unconditionally, ignoring
// `above`). classify_stage is the source of truth used on the stock-detail page,
// so we port it. (Discrepancy flagged for upstream cleanup.)

import type { ISODate, RSPoint, Stage, StageBar, StagePoint, StageSegment } from "./types";

// ---- constants (named, matching the Python) --------------------------------
export const MA_WINDOW = 150; // 30-week SMA
export const SLOPE_WINDOW = 20; // ~1 month, to measure MA direction
export const FLAT_PCT = 1.5; // |MA %Δ| below this over SLOPE_WINDOW = "flat"
export const RANGE_WINDOW = 252; // 52 weeks for range position
export const RSI_WINDOW = 14;
export const RS_LOOKBACK = 252;
export const RS_TOL = 0.02;
export const RS_MIN_PERIODS = 5;
/** Bars needed before the FIRST valid stage: ma[i] needs i≥149, ma[i-20] needs i≥169. */
export const STAGE_MIN_BARS = MA_WINDOW + SLOPE_WINDOW; // 170

export const STAGE_LABEL: Record<Stage, string> = {
  1: "Stage 1 — Basing / accumulation",
  2: "Stage 2 — Advancing / uptrend",
  3: "Stage 3 — Topping / distribution",
  4: "Stage 4 — Declining / downtrend",
};
export const STAGE_ACTION: Record<Stage, string> = {
  1: "Watchlist — wait for a Stage 2 breakout.",
  2: "Uptrend — the ownable stage.",
  3: "Distribution — tighten stops / take profits.",
  4: "Downtrend — avoid / stay away.",
};

// ---- small helpers ---------------------------------------------------------
/** Round-half-to-even (banker's), matching Python 3's `round()` — so the mock's
 *  scalars are digit-for-digit identical to the future FastAPI wire shape, not
 *  just close. (Half-up + an EPSILON bias would disagree with Python on ties.) */
export function round(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** digits;
  const scaled = x * f;
  const nearest = Math.round(scaled);
  // Math.round is half-up; correct only the exact-tie case to half-to-even.
  if (Math.abs(scaled - Math.trunc(scaled)) === 0.5) {
    const lower = Math.floor(scaled);
    return (lower % 2 === 0 ? lower : lower + 1) / f;
  }
  return nearest / f;
}

/** Trailing simple moving average; null for the first `window-1` bars (warmup). */
export function rollingSMA(closes: number[], window: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= window) sum -= closes[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

/** The classify_stage ladder — the ONLY place the stage decision tree lives. */
export function classifyStage(above: boolean, rising: boolean, falling: boolean, rangePos: number): Stage {
  if (above && rising) return 2;
  if (!above && falling) return 4;
  if (rising) return above ? 2 : 1;
  if (falling) return above ? 3 : 4;
  return rangePos >= 50 ? 3 : 1; // MA flat → position in range decides
}

/** Trailing max/min of `closes[lo..i]` (inclusive), window = min(RANGE_WINDOW, i+1). */
function rangePosAt(closes: number[], i: number): number {
  const lo0 = Math.max(0, i - RANGE_WINDOW + 1);
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = lo0; j <= i; j++) {
    if (closes[j] > hi) hi = closes[j];
    if (closes[j] < lo) lo = closes[j];
  }
  return hi > lo ? ((closes[i] - lo) / (hi - lo)) * 100 : 50;
}

/**
 * Per-bar Weinstein stage + sub-signals, index-aligned to `closes`/`dates`.
 * stage is null until index ≥ 169 (needs ma[i] and ma[i-20]).
 */
export function computeStageBars(closes: number[], dates: ISODate[]): StageBar[] {
  const ma = rollingSMA(closes, MA_WINDOW);
  const out: StageBar[] = new Array(closes.length);
  for (let i = 0; i < closes.length; i++) {
    const maNow = ma[i];
    const maPrev = i - SLOPE_WINDOW >= 0 ? ma[i - SLOPE_WINDOW] : null;
    let stage: Stage | null = null;
    let aboveMa = false;
    let maSlopePct: number | null = null;
    let rangePos: number | null = null;
    if (maNow != null) {
      aboveMa = closes[i] > maNow;
      if (maPrev != null && maPrev !== 0) {
        maSlopePct = ((maNow - maPrev) / maPrev) * 100;
        rangePos = rangePosAt(closes, i);
        const rising = maSlopePct > FLAT_PCT;
        const falling = maSlopePct < -FLAT_PCT;
        stage = classifyStage(aboveMa, rising, falling, rangePos);
      }
    }
    out[i] = { date: dates[i], stage, aboveMa, maSlopePct, rangePos };
  }
  return out;
}

/** Run-length-encode stageBars into maximal same-stage segments; drop null runs. */
export function segmentsFromStageBars(bars: StageBar[]): StageSegment[] {
  const segs: StageSegment[] = [];
  let cur: StageSegment | null = null;
  for (let i = 0; i < bars.length; i++) {
    const s = bars[i].stage;
    if (s == null) {
      if (cur) {
        segs.push(cur);
        cur = null;
      }
      continue;
    }
    if (cur && cur.stage === s) {
      cur.endDate = bars[i].date;
      cur.endIndex = i;
    } else {
      if (cur) segs.push(cur);
      cur = { stage: s, startDate: bars[i].date, endDate: bars[i].date, startIndex: i, endIndex: i };
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

/** Cutler/SMA-based RSI(14) — mean gains / mean losses, NOT Wilder. Latest bar only
 *  (matches the Python, which returns a scalar). null if fewer than 15 closes. */
export function rsi14Cutler(closes: number[]): number | null {
  const n = closes.length;
  if (n < RSI_WINDOW + 1) return null;
  let gain = 0;
  let loss = 0;
  // trailing 14 deltas ending at the last close (indices n-14..n-1 vs prev)
  for (let i = n - RSI_WINDOW; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss += -d;
  }
  gain /= RSI_WINDOW;
  loss /= RSI_WINDOW;
  if (loss === 0) return null; // rs = gain/NaN → NaN → None in Python
  const rs = gain / loss;
  return round(100 - 100 / (1 + rs), 1);
}

/**
 * RS line vs a benchmark, per bar. rs = close/benchClose (index/date-aligned).
 * rsHigh252 = rolling(252, minPeriods 5) max; newHigh = rs ≥ rsHigh252*(1-0.02).
 * Mirrors screener.rs_line_new_high (which is the latest-bar case of this).
 */
export function rsSeries(closes: number[], bench: number[], dates: ISODate[]): RSPoint[] {
  const n = Math.min(closes.length, bench.length, dates.length);
  const out: RSPoint[] = [];
  const rsVals: number[] = [];
  for (let i = 0; i < n; i++) {
    const rs = closes[i] / bench[i];
    rsVals.push(rs);
    let rsHigh: number | null = null;
    let newHigh = false;
    if (i + 1 >= RS_MIN_PERIODS) {
      const lo0 = Math.max(0, i - RS_LOOKBACK + 1);
      let hi = -Infinity;
      for (let j = lo0; j <= i; j++) if (rsVals[j] > hi) hi = rsVals[j];
      rsHigh = hi;
      newHigh = rs >= hi * (1 - RS_TOL);
    }
    out.push({ date: dates[i], rs: round(rs, 4), rsHigh252: rsHigh == null ? null : round(rsHigh, 4), newHigh });
  }
  return out;
}

/** {date, close, ma150} series (API-parity), ma150 rounded to 2dp like Python. */
export function stagePointSeries(closes: number[], dates: ISODate[]): StagePoint[] {
  const ma = rollingSMA(closes, MA_WINDOW);
  return closes.map((c, i) => ({ date: dates[i], close: round(c, 2), ma150: ma[i] == null ? null : round(ma[i] as number, 2) }));
}

/** Percentile rank (0–100) of the LAST value within a series; low = cheap.
 *  null when there are fewer than 4 points (mirrors the rerating min-history rule). */
export function percentileOfLast(xs: number[]): number | null {
  if (xs.length < 4) return null;
  const last = xs[xs.length - 1];
  let below = 0;
  let eq = 0;
  for (const x of xs) {
    if (x < last) below++;
    else if (x === last) eq++;
  }
  return round(((below + 0.5 * eq) / xs.length) * 100, 0);
}

/** Sign of a least-squares slope over evenly-spaced points (-1 / 0 / +1). */
export function slopeSign(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const xbar = (n - 1) / 2;
  const ybar = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  for (let i = 0; i < n; i++) num += (i - xbar) * (xs[i] - ybar);
  return num > 1e-9 ? 1 : num < -1e-9 ? -1 : 0;
}

/**
 * First date of the CURRENT contiguous run of newHigh=true ending at the last
 * RS point (the marker anchor). null if the latest bar is not at a new high.
 */
export function currentNewHighFrom(rs: RSPoint[]): ISODate | null {
  if (rs.length === 0 || !rs[rs.length - 1].newHigh) return null;
  let i = rs.length - 1;
  while (i > 0 && rs[i - 1].newHigh) i--;
  return rs[i].date;
}

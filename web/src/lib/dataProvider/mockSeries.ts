// Deterministic, seedable OHLCV + steady-benchmark generator. Computes NO
// indicators — it hands {bars, benchClose} to analysis.ts, so mock output ==
// the future API wire shape. Same symbol ⇒ identical bytes on server and
// client (SSR-stable): the LCG is pure and dates walk from a FIXED anchor —
// never new Date()/Date.now().
import type { OHLCVBar } from "./types";

export type MockScenario = "full-cycle" | "up" | "down" | "choppy";

/** LCG identical to lib/mock.ts, so both mock surfaces share one RNG. */
export function rng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Stable hash of a symbol → RNG seed (SSR/CSR agree because it's pure). */
export function seedFromSymbol(sym: string): number {
  let a = 7;
  for (let i = 0; i < sym.length; i++) a = (a * 31 + sym.charCodeAt(i)) >>> 0;
  return a || 7;
}

type PhaseKind = "preroll" | "base" | "markup" | "top" | "decline" | "tail";
interface Phase {
  bars: number;
  drift: number;
  driftEnd?: number; // linear-interpolated across the phase when present
  vol: number;
  kind: PhaseKind;
}

const PHASE_MULT: Record<PhaseKind, number> = {
  preroll: 0.8,
  base: 0.8,
  markup: 1.3,
  top: 1.1,
  decline: 1.5,
  tail: 1.0,
};

// Default "full-cycle": a base→markup→top→decline→re-base arc. The 200-bar
// pre-roll exists only so the 150-MA + 20-day slope are valid by the time the
// visible cycle starts (stage becomes valid at bar 169, inside the pre-roll).
const FULL_CYCLE: Phase[] = [
  { bars: 200, drift: 0.0, vol: 0.01, kind: "preroll" },
  { bars: 120, drift: 0.0003, vol: 0.011, kind: "base" },
  { bars: 260, drift: 0.0022, vol: 0.014, kind: "markup" },
  { bars: 120, drift: 0.0001, driftEnd: -0.0002, vol: 0.018, kind: "top" },
  { bars: 200, drift: -0.0026, vol: 0.017, kind: "decline" },
  { bars: 100, drift: 0.0, vol: 0.011, kind: "tail" },
];

function scheduleFor(scenario: MockScenario): Phase[] {
  switch (scenario) {
    case "up":
      return [
        { bars: 200, drift: 0.0, vol: 0.01, kind: "preroll" },
        { bars: 800, drift: 0.0018, vol: 0.014, kind: "markup" },
      ];
    case "down":
      return [
        { bars: 200, drift: 0.0, vol: 0.01, kind: "preroll" },
        { bars: 100, drift: 0.0003, vol: 0.011, kind: "base" },
        { bars: 700, drift: -0.0022, vol: 0.017, kind: "decline" },
      ];
    case "choppy": {
      const ph: Phase[] = [{ bars: 200, drift: 0.0, vol: 0.01, kind: "preroll" }];
      for (let b = 0; b < 4; b++) {
        ph.push({ bars: 100, drift: 0.0018, vol: 0.015, kind: "markup" });
        ph.push({ bars: 100, drift: -0.0018, vol: 0.016, kind: "decline" });
      }
      return ph;
    }
    default:
      return FULL_CYCLE;
  }
}

/** Expand phases into per-bar {drift, vol, kind}. */
function expand(phases: Phase[]): { drift: number; vol: number; kind: PhaseKind }[] {
  const out: { drift: number; vol: number; kind: PhaseKind }[] = [];
  for (const p of phases) {
    for (let i = 0; i < p.bars; i++) {
      const drift = p.driftEnd != null && p.bars > 1 ? p.drift + (p.driftEnd - p.drift) * (i / (p.bars - 1)) : p.drift;
      out.push({ drift, vol: p.vol, kind: p.kind });
    }
  }
  return out;
}

/** Business-day dates walking forward from a FIXED anchor Monday (UTC), Mon–Fri. */
export function businessDates(n: number, anchor = "2022-01-03"): string[] {
  const dates: string[] = [];
  const [y, m, d] = anchor.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  while (dates.length < n) {
    const wd = t.getUTCDay(); // 0=Sun..6=Sat
    if (wd !== 0 && wd !== 6) dates.push(t.toISOString().slice(0, 10));
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return dates;
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export interface MockSeries {
  bars: OHLCVBar[];
  benchClose: number[];
  dates: string[];
}

/**
 * Generate `dates.length` daily bars for one symbol plus a steady benchmark on
 * the SAME dates. Deterministic in (seed, scenario). The stock out-drifts the
 * benchmark through markup (0.0022 vs 0.0004) so RS = close/bench makes a
 * genuine new high late in the advance, then rolls over in the decline.
 */
export function generate(opts: { seed: number; scenario?: MockScenario; benchSeed?: number } = { seed: 7 }): MockSeries {
  const scenario = opts.scenario ?? "full-cycle";
  const schedule = expand(scheduleFor(scenario));
  const n = schedule.length;
  const dates = businessDates(n);

  const r = rng(opts.seed);
  const bars: OHLCVBar[] = [];
  let prevClose = 30;
  for (let i = 0; i < n; i++) {
    const { drift, vol, kind } = schedule[i];
    // 1) close via the price step
    let close = i === 0 ? 30 : prevClose * (1 + drift + (r() - 0.5) * 2 * vol);
    close = Math.max(close, 0.5);
    // 2) open gaps modestly off the prior close
    const open = i === 0 ? close : Math.max(prevClose * (1 + (r() - 0.5) * 0.004), 0.5);
    // 3) wick extents
    const k = (0.3 + 0.7 * r()) * vol;
    const hi = Math.max(open, close) * (1 + k);
    const lo = Math.min(open, close) * (1 - k);
    // 4) volume corroborates the phase (breakout / climax spikes)
    const dayReturn = i === 0 ? 0 : (close - prevClose) / prevClose;
    const volume = Math.round(1e6 * (0.7 + 0.6 * r()) * PHASE_MULT[kind] * (1 + 2 * Math.abs(dayReturn)));

    bars.push({
      date: dates[i],
      open: round2(open),
      high: round2(Math.max(hi, open, close)),
      low: round2(Math.min(lo, open, close)),
      close: round2(close),
      volume,
    });
    prevClose = close;
  }

  // Steady benchmark (SPY-like) on the same dates, independent seed.
  const rb = rng(opts.benchSeed ?? opts.seed + 101);
  const benchClose: number[] = [];
  let bp = 400;
  for (let i = 0; i < n; i++) {
    bp = i === 0 ? 400 : Math.max(bp * (1 + 0.0004 + (rb() - 0.5) * 2 * 0.008), 1);
    benchClose.push(round2(bp));
  }

  return { bars, benchClose, dates };
}

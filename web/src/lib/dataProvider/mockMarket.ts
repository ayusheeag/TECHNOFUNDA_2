// Market-wide surfaces derived from the universe's shared charts: breadth /
// regime (breadth.py parity — EMA200, thresholds 60/40), the sector-ETF RSI
// leaderboard, and industry growth. All memoized module-level: deterministic
// and constant, so getMeta on every route is cheap.
import { round } from "./analysis";
import { REGIME_META } from "./interpret";
import { fundamentalsFor } from "./mockFundamentals";
import { chartFor } from "./mockChart";
import { SECTORS, UNIVERSE } from "./universe";
import type { BreadthHistory, BreadthRow, IndustryGrowthRow, RegimeResponse, Regime, SectorScore, SoundChip } from "./types";
import type { Interpretation } from "@/lib/types";

/** EMA with adjust=false (alpha = 2/(span+1)), matching pandas ewm. */
function ema(closes: number[], span: number): number[] {
  const a = 2 / (span + 1);
  const out: number[] = new Array(closes.length);
  let prev = closes[0];
  out[0] = prev;
  for (let i = 1; i < closes.length; i++) {
    prev = a * closes[i] + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

/** Trailing-window max via a monotonic deque (O(n)). */
function rollingMax(xs: number[], window: number): number[] {
  const out: number[] = new Array(xs.length);
  const dq: number[] = []; // indices, decreasing values
  for (let i = 0; i < xs.length; i++) {
    while (dq.length && xs[dq[dq.length - 1]] <= xs[i]) dq.pop();
    dq.push(i);
    while (dq[0] <= i - window) dq.shift();
    out[i] = xs[dq[0]];
  }
  return out;
}

export function classifyRegime(pctAbove200: number): Regime {
  return pctAbove200 >= 60 ? "aggressive" : pctAbove200 >= 40 ? "moderate" : "shallow";
}

interface SymSeries {
  closes: number[];
  ema200: number[];
  ema50: number[];
  hi252: number[];
}

let _breadthMemo: BreadthHistory | null = null;
let _seriesMemo: SymSeries[] | null = null;

function symSeries(): SymSeries[] {
  if (_seriesMemo) return _seriesMemo;
  _seriesMemo = UNIVERSE.map((u) => {
    const closes = chartFor(u.symbol).series.map((p) => p.close);
    return { closes, ema200: ema(closes, 200), ema50: ema(closes, 50), hi252: rollingMax(closes, 252) };
  });
  return _seriesMemo;
}

export function getBreadthHistory(): BreadthHistory {
  if (_breadthMemo) return _breadthMemo;
  const series = symSeries();
  const N = series.length;
  const len = series[0].closes.length;
  const start = Math.max(252, len - 130); // ~130-session window for the spark, once EMAs are meaningful
  const rows: BreadthRow[] = [];
  for (let i = start; i < len; i++) {
    let a200 = 0;
    let a50 = 0;
    let nh = 0;
    let nl = 0;
    for (const s of series) {
      if (s.closes[i] > s.ema200[i]) a200++;
      if (s.closes[i] > s.ema50[i]) a50++;
      if (s.closes[i] >= s.hi252[i] * 0.98) nh++;
      // new low: within 2% of the trailing-252 low (compute cheaply via min of ema? use closes min)
      if (s.closes[i] <= minTrailing(s.closes, i, 252) * 1.02) nl++;
    }
    const pct200 = round((a200 / N) * 100, 1);
    rows.push({
      date: chartFor(UNIVERSE[0].symbol).series[i].date,
      pctAbove200ema: pct200,
      pctAbove50ema: round((a50 / N) * 100, 1),
      new52wHighs: nh,
      new52wLows: nl,
      regime: classifyRegime(pct200),
    });
  }
  const latest = rows[rows.length - 1];
  const pctSpark = rows.map((r) => r.pctAbove200ema);
  const nhSpark = rows.map((r) => r.new52wHighs);
  const trend = pctSpark[pctSpark.length - 1] - pctSpark[0];
  _breadthMemo = {
    rows,
    latest,
    pctSpark,
    nhSpark,
    interpretation: {
      headline: `${latest.pctAbove200ema.toFixed(0)}% of the universe is above its 200-day`,
      tone: latest.regime === "aggressive" ? "good" : latest.regime === "shallow" ? "bad" : "neutral",
      detail: `${trend >= 0 ? "Breadth improving" : "Breadth deteriorating"} over the last few months; ${latest.new52wHighs} names at new 52-week highs.`,
    },
  };
  return _breadthMemo;
}

function minTrailing(xs: number[], i: number, window: number): number {
  let m = Infinity;
  for (let j = Math.max(0, i - window + 1); j <= i; j++) if (xs[j] < m) m = xs[j];
  return m;
}

export function getRegime(): RegimeResponse {
  const b = getBreadthHistory().latest;
  const regime = b.regime;
  const meta = REGIME_META[regime];
  const interpretation: Interpretation = {
    headline: `${cap(regime)} regime — ${meta.sizing.split(" — ")[1] ?? meta.sizing}`,
    tone: regime === "aggressive" ? "good" : regime === "shallow" ? "bad" : "neutral",
    detail: `${b.pctAbove200ema.toFixed(0)}% of the universe is above its 200-day and ${b.new52wHighs} sit at new highs — ${meta.sizing.toLowerCase()}`,
  };
  return {
    regime,
    pctAbove200ema: b.pctAbove200ema,
    pctAbove50ema: b.pctAbove50ema,
    new52wHighs: b.new52wHighs,
    universeSize: UNIVERSE.length,
    icon: meta.glyph,
    sizingText: meta.sizing,
    interpretation,
  };
}

// ---- sectors ---------------------------------------------------------------
let _sectorsMemo: SectorScore[] | null = null;
const _sectorPeMedian = new Map<string, number | null>();

/** Median latest P/E across a sector's constituents (P/E > 0 only). */
export function sectorPeMedian(sector: string): number | null {
  if (_sectorPeMedian.has(sector)) return _sectorPeMedian.get(sector) as number | null;
  const pes = UNIVERSE.filter((u) => u.sector === sector)
    .map((u) => fundamentalsFor(u.symbol).latest.pe)
    .filter((x): x is number => x != null && x > 0)
    .sort((a, b) => a - b);
  const med = pes.length ? (pes.length % 2 ? pes[(pes.length - 1) / 2] : (pes[pes.length / 2 - 1] + pes[pes.length / 2]) / 2) : null;
  const val = med == null ? null : round(med, 1);
  _sectorPeMedian.set(sector, val);
  return val;
}

function leadScore(symbol: string): number {
  const c = chartFor(symbol);
  const base = c.stage ? { 1: 45, 2: 75, 3: 35, 4: 12 }[c.stage] : 0;
  return base + (c.rsNewHigh ? 12 : 0) + (c.rangePos ?? 50) * 0.2;
}

export function getSectors(): SectorScore[] {
  if (_sectorsMemo) return _sectorsMemo;
  const rows: SectorScore[] = SECTORS.map((s) => {
    const c = chartFor(s.etf);
    const closes = c.series.map((p) => p.close);
    const e200 = ema(closes, 200);
    const e50 = ema(closes, 50);
    const hi = rollingMax(closes, 252);
    const i = closes.length - 1;
    const above200 = closes[i] > e200[i];
    const rsi14 = c.rsi14;
    const pctFrom52wHigh = hi[i] > 0 ? round((closes[i] / hi[i] - 1) * 100, 1) : null;
    const monthsAboveTrend = monthsAbove(closes, e200);
    const soundNotStretched = above200 && (rsi14 == null || rsi14 < 70) && monthsAboveTrend <= 18;
    const chip: SoundChip = !above200 ? "below-trend" : rsi14 != null && rsi14 >= 70 ? "stretched" : "sound";
    const leaders = UNIVERSE.filter((u) => u.sector === s.key)
      .sort((a, b) => leadScore(b.symbol) - leadScore(a.symbol))
      .slice(0, 2)
      .map((u) => u.symbol);
    const interpretation: Interpretation = {
      headline: `${s.key} — ${chip === "sound" ? "sound uptrend" : chip === "stretched" ? "extended, overbought" : "below trend"}`,
      tone: chip === "sound" ? "good" : chip === "stretched" ? "warn" : "bad",
      detail:
        chip === "sound"
          ? `${s.etf} above its 200-day, RSI ${rsi14 == null ? "—" : Math.round(rsi14)} — healthy, not stretched.`
          : chip === "stretched"
            ? `${s.etf} in an uptrend but RSI ${rsi14 == null ? "—" : Math.round(rsi14)} is overbought — wait for a pullback.`
            : `${s.etf} below its 200-day — avoid new longs in this sector.`,
    };
    return {
      sector: s.key,
      etf: s.etf,
      close: round(closes[i], 2),
      rsi14,
      above200ema: above200,
      above50ema: closes[i] > e50[i],
      pctFrom52wHigh,
      monthsAboveTrend,
      soundNotStretched,
      chip,
      leaderSymbols: leaders,
      interpretation,
    };
  }).sort((a, b) => (b.rsi14 ?? -1) - (a.rsi14 ?? -1));
  _sectorsMemo = rows;
  return rows;
}

function monthsAbove(closes: number[], e200: number[]): number {
  let days = 0;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] > e200[i]) days++;
    else break;
  }
  return round(days / 21, 0); // ~21 trading days per month
}

// ---- industries ------------------------------------------------------------
let _industriesMemo: IndustryGrowthRow[] | null = null;

export function getIndustryGrowth(): IndustryGrowthRow[] {
  if (_industriesMemo) return _industriesMemo;
  const byIndustry = new Map<string, { sector: string; revs: number[]; stage2: number; total: number }>();
  for (const u of UNIVERSE) {
    const rev = fundamentalsFor(u.symbol).latest.revenueYoY;
    const stage = chartFor(u.symbol).stage;
    const g = byIndustry.get(u.industry) ?? { sector: u.sector, revs: [], stage2: 0, total: 0 };
    if (rev != null) g.revs.push(rev);
    if (stage === 2) g.stage2++;
    g.total++;
    byIndustry.set(u.industry, g);
  }
  const rows: IndustryGrowthRow[] = [];
  for (const [industry, g] of byIndustry) {
    const median = g.revs.length ? round(medianOf(g.revs), 1) : null;
    const breadthPctStage2 = round((g.stage2 / g.total) * 100, 0);
    rows.push({
      industry,
      sector: g.sector,
      medianRevYoY: median,
      breadthPctStage2,
      interpretation: {
        headline: `${industry} — median revenue ${median == null ? "n/a" : `${median >= 0 ? "+" : "−"}${Math.abs(median).toFixed(0)}%`}`,
        tone: median != null && median >= 20 ? "good" : median != null && median < 5 ? "bad" : "neutral",
        detail: `${breadthPctStage2}% of names in a Stage-2 uptrend.`,
      },
    });
  }
  _industriesMemo = rows.sort((a, b) => (b.medianRevYoY ?? -999) - (a.medianRevYoY ?? -999));
  return _industriesMemo;
}

function medianOf(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

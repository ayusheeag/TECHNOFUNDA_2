// The price/technical truth for one symbol — generate() → analysis.ts → the
// StockChartResponse wire shape. Extracted from mockProvider so every derived
// surface (screener row, composite, detail chart, watchlist) reads the SAME
// memoized chart via chartFor(symbol). That is the core Phase-3 invariant: a
// symbol's stage/RS/close on the screener equals what its detail chart draws.
import {
  STAGE_ACTION,
  STAGE_LABEL,
  computeStageBars,
  currentNewHighFrom,
  rollingSMA,
  round,
  rsSeries,
  rsi14Cutler,
  segmentsFromStageBars,
  stagePointSeries,
} from "./analysis";
import { marketPhase } from "./cache";
import { buildAriaSummary, buildHeaderInterpretation } from "./interpret";
import { generate, seedFromSymbol, type MockScenario } from "./mockSeries";
import type { GetStockChartOptions, StageSnapshot, StockChartResponse } from "./types";

/**
 * Deterministic scenario per symbol, weighted toward leaders so the universe
 * shows a realistic Stage 1–4 spread. build()'s DEFAULT scenario uses this, so
 * the detail chart and the composite agree by construction.
 */
const SCENARIOS: MockScenario[] = ["up", "full-cycle", "full-cycle", "up", "choppy", "down", "full-cycle", "up"];
export function scenarioForSymbol(symbol: string): MockScenario {
  return SCENARIOS[seedFromSymbol(symbol) % SCENARIOS.length];
}

export function build(symbol: string, opts?: GetStockChartOptions): StockChartResponse {
  const benchmark = opts?.benchmark ?? "SPY";
  const seed = opts?.seed ?? seedFromSymbol(symbol);
  const scenario: MockScenario = (opts?.regime as MockScenario) ?? scenarioForSymbol(symbol);

  const { bars, benchClose, dates } = generate({ seed, scenario });
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const last = n - 1;

  const ma = rollingSMA(closes, 150);
  const stageBars = computeStageBars(closes, dates);
  const stageSegments = segmentsFromStageBars(stageBars);
  const series = stagePointSeries(closes, dates);
  const rs = rsSeries(closes, benchClose, dates);

  const lb = stageBars[last];
  const ma150 = ma[last] == null ? null : round(ma[last] as number, 2);
  const rsNewHigh = rs.length > 0 ? rs[rs.length - 1].newHigh : false;
  const stage = lb.stage;
  const rsi14 = rsi14Cutler(closes);

  const interpretation = buildHeaderInterpretation({
    stage,
    close: closes[last],
    ma150,
    maSlopePct: lb.maSlopePct,
    rangePos: lb.rangePos,
    rsNewHigh,
    benchmark,
  });
  const ariaSummary = buildAriaSummary({
    symbol,
    days: n,
    stage,
    close: closes[last],
    ma150,
    maSlopePct: lb.maSlopePct,
    rangePos: lb.rangePos,
    rsi14,
    rsNewHigh,
    benchmark,
    lastDate: dates[last],
  });

  return {
    symbol,
    stage,
    label: stage == null ? "Insufficient history" : STAGE_LABEL[stage],
    action: stage == null ? "Backfill more price history for a stage read." : STAGE_ACTION[stage],
    close: round(closes[last], 2),
    ma150,
    aboveMa: lb.aboveMa,
    maSlopePct: lb.maSlopePct == null ? null : round(lb.maSlopePct, 2),
    rangePos: lb.rangePos == null ? null : round(lb.rangePos, 1),
    rsi14,
    days: n,
    series,
    interpretation,
    ariaSummary,
    bars,
    stageBars,
    stageSegments,
    rs,
    rsNewHigh,
    rsNewHighFrom: currentNewHighFrom(rs),
    meta: {
      source: "mock",
      generatedAt: new Date().toISOString(), // provenance only — not a series input
      benchmarkSymbol: benchmark,
      marketPhase: marketPhase(),
      stale: false,
      currency: "USD",
      firstDate: dates[0],
      lastDate: dates[last],
    },
  };
}

// Memoize the DEFAULT-scenario chart per symbol so all derived surfaces share
// one object. Keyed by symbol only (default opts); explicit-opts calls bypass it.
const _chartMemo = new Map<string, StockChartResponse>();
export function chartFor(symbol: string): StockChartResponse {
  const key = symbol.toUpperCase();
  let c = _chartMemo.get(key);
  if (!c) {
    c = build(key);
    _chartMemo.set(key, c);
  }
  return c;
}

/** Last `n` closes — the spark the screener/watchlist rows draw. */
export function sparkOf(chart: StockChartResponse, n = 40): number[] {
  return chart.series.slice(-n).map((p) => p.close);
}

export function projectSnapshot(r: StockChartResponse): StageSnapshot {
  return {
    symbol: r.symbol,
    stage: r.stage,
    label: r.label,
    action: r.action,
    close: r.close,
    ma150: r.ma150,
    aboveMa: r.aboveMa,
    maSlopePct: r.maSlopePct,
    rangePos: r.rangePos,
    rsi14: r.rsi14,
    days: r.days,
    series: r.series,
    interpretation: r.interpretation,
    rsNewHigh: r.rsNewHigh,
  };
}

/** Day change % from the last two closes of the shared series. */
export function changePctOf(r: StockChartResponse): number {
  const b = r.bars;
  return b.length >= 2 ? round(((b[b.length - 1].close / b[b.length - 2].close) - 1) * 100, 2) : 0;
}

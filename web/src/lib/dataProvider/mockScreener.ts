// Screener + re-rating rows. Each ScreenRow joins the SAME memoized chart
// (chartFor) + fundamentals + composite, so a row's stage/RS/close/spark equal
// what its detail page shows. Score + rerating flag mirror the Python formulas
// (screener.screen score, rerating_scorecard flag).
import { percentileOfLast, round, slopeSign } from "./analysis";
import { buildComposite } from "./composite";
import { changePctOf, chartFor, sparkOf } from "./mockChart";
import { fundamentalsFor } from "./mockFundamentals";
import { sectorPeMedian } from "./mockMarket";
import { UNIVERSE, lookup } from "./universe";
import type { Interpretation } from "@/lib/types";
import type { ReratingRow, ScreenParams, ScreenRow, Verdict } from "./types";

const VERDICT_WORD: Record<Verdict, string> = { act: "Act", watch: "Watch", avoid: "Avoid" };

function hi252(closes: number[]): number {
  return Math.max(...closes.slice(-252));
}

export function buildScreenRow(symbol: string): ScreenRow {
  const u = lookup(symbol);
  const chart = chartFor(symbol);
  const fund = fundamentalsFor(symbol);
  const closes = chart.series.map((p) => p.close);
  const hi = hi252(closes);
  const pctBelowHigh = hi > 0 ? round(100 * (1 - chart.close / hi), 1) : null;
  const at52wHigh = hi > 0 && chart.close >= hi * 0.98;
  const revenueYoY = fund.latest.revenueYoY;
  const rsNewHigh = chart.rsNewHigh;
  const score = round((revenueYoY ?? 0) - (pctBelowHigh ?? 50) * 0.5 + (rsNewHigh ? 10 : 0), 1);
  const composite = buildComposite({ chart, fund, sectorPeMedian: sectorPeMedian(u?.sector ?? "") });

  const revTxt = revenueYoY == null ? "n/a" : `${revenueYoY >= 0 ? "+" : "−"}${Math.abs(revenueYoY).toFixed(0)}%`;
  const stageTxt = chart.stage === 2 ? "Stage 2 uptrend" : chart.stage === 4 ? "Stage 4 downtrend" : chart.stage === 3 ? "Stage 3 topping" : chart.stage === 1 ? "Stage 1 base" : "no stage";
  const interpretation: Interpretation = {
    headline: `${VERDICT_WORD[composite.verdict as Verdict]} — ${stageTxt}, revenue ${revTxt}${rsNewHigh ? ", RS leading" : ""}`,
    tone: composite.verdict === "act" ? "good" : composite.verdict === "avoid" ? "bad" : "warn",
    detail: composite.interpretation.detail,
  };

  return {
    symbol,
    name: u?.name ?? symbol,
    sector: u?.sector ?? "—",
    industry: u?.industry ?? "—",
    close: chart.close,
    changePct: changePctOf(chart),
    revenueYoY,
    epsYoY: fund.latest.epsYoY,
    debtToEquity: fund.latest.debtToEquity,
    currentRatio: fund.latest.currentRatio,
    roe: fund.latest.roe,
    fcf: fund.latest.fcf,
    pe: fund.latest.pe,
    evEbitda: fund.latest.evEbitda,
    rsi14: chart.rsi14,
    rsLine: chart.rs.length ? chart.rs[chart.rs.length - 1].rs : null,
    rsNewHigh,
    at52wHigh,
    pctBelowHigh,
    stage: chart.stage,
    score,
    spark: sparkOf(chart),
    composite,
    interpretation,
  };
}

let _rowsMemo: ScreenRow[] | null = null;
function allRows(): ScreenRow[] {
  if (!_rowsMemo) _rowsMemo = UNIVERSE.map((u) => buildScreenRow(u.symbol));
  return _rowsMemo;
}

export function getScreenDefault(): ScreenRow[] {
  return allRows().slice().sort((a, b) => b.score - a.score);
}

export function runScreen(params: ScreenParams): ScreenRow[] {
  const minGrowth = params.minGrowth ?? 15;
  const maxDE = params.maxDE ?? 1.0;
  const minCR = params.minCurrentRatio ?? 1.2;
  const inds = params.industries && params.industries.length ? new Set(params.industries) : null;
  return allRows()
    .filter((r) => (r.revenueYoY ?? -999) >= minGrowth)
    .filter((r) => (r.debtToEquity ?? 999) <= maxDE)
    .filter((r) => (r.currentRatio ?? 0) >= minCR)
    .filter((r) => !inds || inds.has(r.industry))
    .sort((a, b) => b.score - a.score);
}

export function getSectorConstituents(sector: string): ScreenRow[] {
  return allRows()
    .filter((r) => r.sector === sector)
    .sort((a, b) => b.score - a.score);
}

let _rrMemo: ReratingRow[] | null = null;

export function getRerating(onlyFlagged = false): ReratingRow[] {
  if (!_rrMemo) {
    _rrMemo = UNIVERSE.map((u) => {
      const fund = fundamentalsFor(u.symbol);
      const chart = chartFor(u.symbol);
      const peSeries = fund.peSeries;
      const peNow = fund.latest.pe;
      const pePctile = percentileOfLast(peSeries);
      const peMedian = peSeries.length ? round(medianOf(peSeries), 1) : null;
      const secMed = sectorPeMedian(u.sector);
      const peVsSector = secMed && peNow ? round(100 * (peNow / secMed - 1), 0) : null;
      const revGrowthNow = fund.latest.revenueYoY;
      const annualRev = fund.annual.map((a) => a.revenueYoY).filter((x): x is number => x != null);
      const revGrowthSlope = slopeSign(annualRev);
      const flagged = pePctile != null && pePctile <= 50 && (peVsSector ?? 0) <= 10 && revGrowthSlope > 0 && (revGrowthNow ?? 0) > 0;
      const interpretation: Interpretation = {
        headline: flagged
          ? `Re-rating setup — cheap vs its own range while growth accelerates`
          : pePctile == null
            ? "Not enough valuation history"
            : `No re-rating edge — ${pePctile >= 60 ? "richly valued" : "growth not confirming"}`,
        tone: flagged ? "good" : "neutral",
        detail:
          pePctile == null
            ? "Fewer than 4 P/E points."
            : `P/E in the ${pePctile}th percentile of its range${peVsSector == null ? "" : `, ${peVsSector >= 0 ? "+" : "−"}${Math.abs(peVsSector)}% vs sector`}; revenue ${(revGrowthNow ?? 0) >= 0 ? "growing" : "shrinking"} and ${revGrowthSlope > 0 ? "accelerating" : revGrowthSlope < 0 ? "decelerating" : "flat"}.`,
      };
      return {
        symbol: u.symbol,
        name: u.name,
        sector: u.sector,
        industry: u.industry,
        peNow,
        peMedian,
        pePctile,
        sectorPeMedian: secMed,
        peVsSector,
        revGrowthNow,
        revGrowthSlope,
        flagged,
        spark: sparkOf(chart),
        interpretation,
      };
    }).sort((a, b) => Number(b.flagged) - Number(a.flagged) || (a.pePctile ?? 100) - (b.pePctile ?? 100));
  }
  return onlyFlagged ? _rrMemo.filter((r) => r.flagged) : _rrMemo;
}

function medianOf(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

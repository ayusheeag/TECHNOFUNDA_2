// buildComposite — the TechnoFunda composite score. Pure + deterministic +
// golden-testable. The TECHNICAL leg is read straight from `chart` (the same
// memoized StockChartResponse the detail chart draws), so the chart and the
// composite AGREE by construction. Provisional legs (ownership, valuation)
// still count at FULL weight per the locked "strengthen-composite-now"
// decision — only NULL legs drop out and the rest renormalize.
import type { CompositeScore, Interpretation, SubScore } from "@/lib/types";
import { FLAT_PCT, percentileOfLast, round } from "./analysis";
import { STAGE_SHORT, STAGE_TONE } from "./interpret";
import type { Fundamentals } from "./mockFundamentals";
import { seedFromSymbol } from "./mockSeries";
import type { Stage, StockChartResponse, Verdict } from "./types";

const clamp = (x: number) => Math.max(0, Math.min(100, x));

const WEIGHTS = { technical: 0.4, growth: 0.3, ownership: 0.15, valuation: 0.15 } as const;

function technicalLeg(chart: StockChartResponse): SubScore {
  const stage = chart.stage;
  if (stage == null) {
    return { value: null, provisional: false, interpretation: { headline: "No technical read", tone: "neutral", detail: "Needs 170 sessions of history." } };
  }
  const stageBase = { 1: 45, 2: 75, 3: 35, 4: 12 }[stage];
  const proximity = 0.15 * ((chart.rangePos ?? 50) - 50); // ±7.5, centred so mid-range is neutral
  const rsBonus = chart.rsNewHigh ? 12 : 0;
  const trendBonus = chart.aboveMa ? 6 : 0;
  const slopeNudge = chart.maSlopePct == null ? 0 : chart.maSlopePct > FLAT_PCT ? 4 : chart.maSlopePct < -FLAT_PCT ? -4 : 0;
  const value = round(clamp(stageBase + proximity + rsBonus + trendBonus + slopeNudge), 0);
  const rangeWord = (chart.rangePos ?? 50) >= 66 ? "near the top of its 52-week range" : (chart.rangePos ?? 50) <= 33 ? "near the low of its range" : "mid-range";
  const rsWord = chart.rsNewHigh ? "RS at a new high (leading)" : "RS not yet leading";
  return {
    value,
    provisional: false,
    interpretation: { headline: STAGE_SHORT[stage], tone: STAGE_TONE[stage], detail: `${rangeWord}; ${rsWord}.` },
  };
}

function growthLeg(fund: Fundamentals): SubScore {
  const a = fund.annual;
  const last = a[a.length - 1];
  const rev = last?.revenueYoY ?? null;
  const eps = last?.epsYoY ?? null;
  if (rev == null && eps == null) {
    return { value: null, provisional: true, interpretation: { headline: "Growth history unavailable", tone: "neutral", detail: "Not enough reported periods." } };
  }
  const revScore = clamp(50 + 1.4 * (rev ?? 0));
  const epsScore = clamp(50 + 1.0 * (eps ?? 0));
  const parts = [rev != null ? revScore : null, eps != null ? epsScore : null].filter((x): x is number => x != null);
  let base = parts.reduce((s, x) => s + x, 0) / parts.length;
  if (eps != null && eps < 0) base -= 10; // explicit negative-EPS penalty
  const value = round(clamp(base), 0);
  const prevRev = a[a.length - 2]?.revenueYoY ?? null;
  const accel = rev != null && prevRev != null ? (rev > prevRev + 1 ? "accelerating" : rev < prevRev - 1 ? "decelerating" : "steady") : "steady";
  const tone: Interpretation["tone"] = value >= 62 ? "good" : value < 45 ? "bad" : "neutral";
  const revTxt = rev == null ? "n/a" : `${rev >= 0 ? "+" : "−"}${Math.abs(rev).toFixed(0)}%`;
  const epsTxt = eps == null ? "n/a" : `${eps >= 0 ? "+" : "−"}${Math.abs(eps).toFixed(0)}%`;
  return { value, provisional: rev == null || eps == null, interpretation: { headline: `Revenue ${revTxt} YoY, EPS ${epsTxt} — ${accel}`, tone, detail: null } };
}

function ownershipLeg(symbol: string): SubScore {
  const member = seedFromSymbol(symbol) % 7 === 0; // deterministic IBD50/FFTY proxy (~1/7)
  return {
    value: member ? 78 : 46,
    provisional: true, // no real 13F feed exists yet — always provisional
    interpretation: member
      ? { headline: "In the IBD 50 proxy", tone: "good", detail: "Institutional sponsorship present; provisional until a real 13F feed lands." }
      : { headline: "Not in the IBD 50 proxy", tone: "neutral", detail: "Thin ownership signal; provisional until a real 13F feed lands." },
  };
}

function valuationLeg(fund: Fundamentals, sectorPeMedian: number | null): SubScore {
  const pePctile = percentileOfLast(fund.peSeries);
  const peNow = fund.latest.pe;
  const peVsSector = sectorPeMedian && peNow ? round(100 * (peNow / sectorPeMedian - 1), 0) : null;
  if (pePctile == null) {
    return { value: null, provisional: true, interpretation: { headline: "Valuation history too thin", tone: "neutral", detail: "Fewer than 4 P/E points; provisional on the free tier." } };
  }
  const cheapSelf = 100 - pePctile;
  const peerAdj = Math.max(-15, Math.min(15, -0.3 * (peVsSector ?? 0)));
  const value = round(clamp(cheapSelf * 0.7 + 50 * 0.3 + peerAdj), 0);
  const sectorTxt = peVsSector == null ? "" : ` ${peVsSector >= 0 ? "+" : "−"}${Math.abs(peVsSector)}% vs sector;`;
  const tone: Interpretation["tone"] = pePctile <= 40 ? "good" : pePctile >= 75 ? "warn" : "neutral";
  const room = pePctile <= 40 ? "re-rating room" : pePctile >= 75 ? "priced for growth" : "fairly valued vs its own range";
  return { value, provisional: true, interpretation: { headline: `P/E in the ${pePctile}th percentile of its own range;${sectorTxt} ${room}`, tone, detail: "Per-name valuation is sparse on the free tier — provisional." } };
}

const legLabel: Record<keyof typeof WEIGHTS, string> = { technical: "technicals", growth: "the growth line", ownership: "ownership", valuation: "valuation" };

export function buildComposite(input: { chart: StockChartResponse; fund: Fundamentals; sectorPeMedian: number | null }): CompositeScore {
  const { chart, fund, sectorPeMedian } = input;
  const technical = technicalLeg(chart);
  const growth = growthLeg(fund);
  const ownership = ownershipLeg(chart.symbol);
  const valuation = valuationLeg(fund, sectorPeMedian);
  const legs = { technical, growth, ownership, valuation };

  // Headline: full-weight provisional legs; drop only NULL legs and renormalize.
  let wSum = 0;
  let acc = 0;
  (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).forEach((k) => {
    const v = legs[k].value;
    if (v != null) {
      wSum += WEIGHTS[k];
      acc += WEIGHTS[k] * v;
    }
  });
  const headline = wSum > 0 ? round(acc / wSum, 0) : 0;

  const t = technical.value ?? 0;
  const stage = chart.stage;
  let verdict: Verdict;
  if (stage === 4 || t < 35 || headline < 45) verdict = "avoid";
  else if (headline >= 68 && t >= 55 && stage === 2) verdict = "act"; // Stage-2 gate
  else verdict = "watch";

  return { headline, verdict, technical, growth, ownership, valuation, interpretation: verdictSentence(verdict, legs, stage) };
}

function verdictSentence(verdict: Verdict, legs: Record<keyof typeof WEIGHTS, SubScore>, stage: Stage | null): Interpretation {
  const scored = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).filter((k) => legs[k].value != null);
  const dominant = scored.slice().sort((a, b) => (legs[b].value as number) * WEIGHTS[b] - (legs[a].value as number) * WEIGHTS[a])[0];
  const drag = scored.slice().sort((a, b) => (legs[a].value as number) - (legs[b].value as number))[0];
  const tone: Interpretation["tone"] = verdict === "act" ? "good" : verdict === "avoid" ? "bad" : "warn";
  const word = verdict === "act" ? "Act" : verdict === "avoid" ? "Avoid" : "Watch";
  const dragProv = drag && legs[drag].provisional ? " (provisional)" : "";
  let detail: string;
  if (verdict === "avoid") {
    detail = stage === 4 ? "In a Stage-4 downtrend — stay away regardless of the numbers." : `${cap(legLabel[drag])} drag the case${dragProv}.`;
  } else if (verdict === "act") {
    detail = `${cap(legLabel[dominant])} lead; ${legLabel[drag]} the only soft spot${dragProv}.`;
  } else {
    detail = `${cap(legLabel[dominant])} support it but ${legLabel[drag]} hold it back${dragProv} — watch, don't chase.`;
  }
  const clause = verdict === "act" ? "the setup lines up" : verdict === "avoid" ? "the case is weak" : "it's mixed";
  return { headline: `${word} — ${clause}`, tone, detail };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

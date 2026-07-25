// Plain-English sentence builders — the "no naked numbers" layer. Pure + lives
// in lib so both the server provider (header interpretation, aria summary) and
// the client canvas (crosshair) share ONE source of phrasing. Lower layer than
// the design system, so components import these — never the reverse.
import type { Interpretation } from "@/lib/types";
import { FLAT_PCT, STAGE_ACTION } from "./analysis";
import type { Stage } from "./types";

function pct(x: number | null | undefined, digits = 1): string {
  if (x == null || Number.isNaN(x)) return "—";
  const s = x > 0 ? "+" : x < 0 ? "−" : "";
  return `${s}${Math.abs(x).toFixed(digits)}%`;
}

function maDirection(slopePct: number | null): "rising" | "falling" | "flat" {
  if (slopePct == null) return "flat";
  if (slopePct > FLAT_PCT) return "rising";
  if (slopePct < -FLAT_PCT) return "falling";
  return "flat";
}

/** Regime glyph + sizing sentence — a lib-side mirror of the design-system
 *  REGIME token, so the provider can fill RegimeResponse without importing UI. */
export const REGIME_META: Record<"aggressive" | "moderate" | "shallow", { glyph: string; sizing: string }> = {
  aggressive: { glyph: "🟢", sizing: "Broad participation — full position sizes reasonable." },
  moderate: { glyph: "🟡", sizing: "Mixed tape — normal position size." },
  shallow: { glyph: "🔴", sizing: "Weak breadth — defensive: small size or cash." },
};

export const STAGE_TONE: Record<Stage, Interpretation["tone"]> = { 1: "neutral", 2: "good", 3: "warn", 4: "bad" };
export const STAGE_SHORT: Record<Stage, string> = {
  1: "Stage 1 — basing",
  2: "Stage 2 — advancing uptrend",
  3: "Stage 3 — topping",
  4: "Stage 4 — declining downtrend",
};

/** pctVsMa = (close/ma150 − 1) × 100, or null when ma150 is unavailable. */
export function pctVsMa(close: number, ma150: number | null): number | null {
  return ma150 == null || ma150 === 0 ? null : (close / ma150 - 1) * 100;
}

export interface HeaderInterpArgs {
  stage: Stage | null;
  close: number;
  ma150: number | null;
  maSlopePct: number | null;
  rangePos: number | null;
  rsNewHigh: boolean;
  benchmark: string;
}

/** The header verdict — one plain-English sentence carrying the numbers. */
export function buildHeaderInterpretation(a: HeaderInterpArgs): Interpretation {
  if (a.stage == null) {
    return { headline: "Not enough history for a stage read", tone: "neutral", detail: "Needs 170 daily sessions." };
  }
  const dir = maDirection(a.maSlopePct);
  const rel = pctVsMa(a.close, a.ma150);
  const side = rel == null ? "near" : rel >= 0 ? "above" : "below";
  const rsBit = a.rsNewHigh
    ? `relative strength vs ${a.benchmark} is at a new high (leading)`
    : `relative strength vs ${a.benchmark} is below its recent high`;
  const detail = `Price is ${pct(rel)} ${side} its ${dir} 150-day average; ${rsBit}. ${STAGE_ACTION[a.stage]}`;
  return { headline: STAGE_SHORT[a.stage], tone: STAGE_TONE[a.stage], detail };
}

/** Compact crosshair sentence, e.g. "Stage 2 · +6.1% vs 150-day · RS leading". */
export function buildCrosshairSentence(stage: Stage | null, rel: number | null, rsNewHigh: boolean): string {
  const parts: string[] = [];
  parts.push(stage == null ? "No stage yet" : STAGE_SHORT[stage].replace(" — ", " · "));
  if (rel != null) parts.push(`${pct(rel)} vs 150-day`);
  parts.push(rsNewHigh ? "RS leading" : "RS not leading");
  return parts.join(" · ");
}

/** RS leadership pill copy (no naked numbers). */
export function rsLeadership(newHigh: boolean, benchmark: string): Interpretation {
  return newHigh
    ? {
        headline: `RS at a new high vs ${benchmark}`,
        tone: "good",
        detail: "Leadership — the stock is outrunning the market.",
      }
    : {
        headline: `RS below its recent high vs ${benchmark}`,
        tone: "neutral",
        detail: "Not leading yet — the stock is lagging the market.",
      };
}

export interface AriaSummaryArgs {
  symbol: string;
  days: number;
  stage: Stage | null;
  close: number;
  ma150: number | null;
  /** RAW (unrounded) slope — so the direction word agrees with the stage
   *  classification, which is also computed from the raw slope. */
  maSlopePct: number | null;
  rangePos: number | null;
  rsi14: number | null;
  rsNewHigh: boolean;
  benchmark: string;
  lastDate: string;
}

/** sr-only summary paragraph — the canonical screen-reader description. Built
 *  server-side (in the provider) from the RAW slope so it never contradicts the
 *  stage read; the client just renders the stored string. */
export function buildAriaSummary(a: AriaSummaryArgs): string {
  if (a.stage == null || a.days < 170) {
    return `${a.symbol} daily chart, ${a.days} sessions. Not enough history for a Weinstein stage read (needs 170).`;
  }
  const dir = maDirection(a.maSlopePct);
  const rel = pctVsMa(a.close, a.ma150);
  const side = rel == null ? "near" : rel >= 0 ? "above" : "below";
  const rsBit = a.rsNewHigh
    ? `Relative strength versus ${a.benchmark} is at a new high.`
    : `Relative strength versus ${a.benchmark} is below its recent high.`;
  return (
    `${a.symbol} daily, ${a.days} sessions ending ${a.lastDate}. ` +
    `Currently ${STAGE_SHORT[a.stage]}. Close ${a.close.toFixed(2)}, ${side} the 150-day average ` +
    `(${pct(rel)}), which is ${dir} ${pct(a.maSlopePct)} over the last month. ` +
    `Range position ${a.rangePos == null ? "—" : Math.round(a.rangePos)} of 100. ` +
    `RSI ${a.rsi14 ?? "—"}. ${rsBit}`
  );
}

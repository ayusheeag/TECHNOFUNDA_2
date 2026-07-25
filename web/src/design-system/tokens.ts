/**
 * Semantic design tokens exposed to TS. Colors themselves live as CSS variables
 * (globals.css); this file carries the meaning-level maps and the direction
 * helper that guarantees direction is never signalled by color alone.
 */

export type Direction = "up" | "down" | "flat";

/** Given a numeric change, return sign glyph + arrow + semantic color class. */
export function direction(delta: number | null | undefined): {
  dir: Direction;
  arrow: string; // ▲ ▼ ▬  — pairs with color so meaning survives colorblindness
  sign: string; // + / − / ""
  className: string; // text-bull | text-bear | text-muted
} {
  if (delta == null || Number.isNaN(delta) || delta === 0)
    return { dir: "flat", arrow: "▬", sign: "", className: "text-muted" };
  if (delta > 0)
    return { dir: "up", arrow: "▲", sign: "+", className: "text-bull" };
  return { dir: "down", arrow: "▼", sign: "−", className: "text-bear" };
}

/** Weinstein stage → glyph + label + tone. */
export const STAGE = {
  1: { glyph: "🔵", label: "Stage 1 · Basing", tone: "neutral" as const },
  2: { glyph: "🟢", label: "Stage 2 · Advancing", tone: "good" as const },
  3: { glyph: "🟠", label: "Stage 3 · Topping", tone: "warn" as const },
  4: { glyph: "🔴", label: "Stage 4 · Declining", tone: "bad" as const },
} as const;

/** Breadth regime → glyph + one-line sizing guidance (the plain-English rule). */
export const REGIME = {
  aggressive: { glyph: "🟢", label: "Aggressive", detail: "Broad participation — full position sizes reasonable.", tone: "good" as const },
  moderate: { glyph: "🟡", label: "Moderate", detail: "Mixed tape — normal position size.", tone: "neutral" as const },
  shallow: { glyph: "🔴", label: "Shallow", detail: "Weak breadth — defensive: small size or cash.", tone: "bad" as const },
} as const;

export type Tone = "good" | "neutral" | "bad" | "warn";

/** Tone → text + soft-background utility classes. (Colors are hex CSS vars, so
 *  we use the pre-mixed `-soft` tokens rather than `/opacity` modifiers.) */
export const TONE_CLASS: Record<Tone, { text: string; bg: string; ring: string }> = {
  good: { text: "text-bull", bg: "bg-bull-soft", ring: "ring-bull" },
  bad: { text: "text-bear", bg: "bg-bear-soft", ring: "ring-bear" },
  warn: { text: "text-warn", bg: "bg-warn-soft", ring: "ring-warn" },
  neutral: { text: "text-muted", bg: "bg-surface-2", ring: "ring-border" },
};

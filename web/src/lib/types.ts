/** Frontend view types. These mirror the planned API Pydantic models
 *  (MIGRATION.md §3.4); the real types will be generated from /openapi.json. */

export interface Interpretation {
  headline: string;
  detail?: string | null;
  tone: "good" | "neutral" | "bad" | "warn";
}

export interface SubScore {
  value: number | null; // 0–100; null ⇒ signal unavailable
  provisional: boolean; // true ⇒ inputs thin (ownership/valuation today)
  interpretation: Interpretation;
}

export interface CompositeScore {
  headline: number; // 0–100 blended
  verdict: string; // "act" | "watch" | "avoid" — map to label/tone in VerdictChip
  technical: SubScore;
  growth: SubScore;
  ownership: SubScore;
  valuation: SubScore;
  interpretation: Interpretation; // one plain-English verdict sentence
}

export interface Stock {
  symbol: string;
  name: string;
  price: number;
  changePct: number; // day change %
  marketCap?: number;
  sector?: string;
  stage?: 1 | 2 | 3 | 4 | null;
  rsNewHigh?: boolean;
  spark?: number[]; // recent closes for the sparkline
  score?: number; // composite headline
}

export type Regime = "aggressive" | "moderate" | "shallow";

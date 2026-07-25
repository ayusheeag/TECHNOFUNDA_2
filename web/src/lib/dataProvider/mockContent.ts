// Earnings / news / concall — all dated deterministically off MOCK_TODAY
// (never Date.now). daysUntil is computed vs that fixed anchor so SSR and the
// client agree. Phrasing is interpretation-first (no naked numbers).
import { round } from "./analysis";
import { MOCK_TODAY } from "./constants";
import { chartFor } from "./mockChart";
import { rng, seedFromSymbol } from "./mockSeries";
import { UNIVERSE, lookup } from "./universe";
import type { ConcallSummary, EarningsRow, NewsItem, Sentiment, TranscriptMeta } from "./types";

function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUTC(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
function addCalendarDays(iso: string, days: number): string {
  return fromUTC(toUTC(iso) + days * 86_400_000);
}
function addBusinessDays(iso: string, n: number): string {
  let t = toUTC(iso);
  let left = n;
  while (left > 0) {
    t += 86_400_000;
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return fromUTC(t);
}
function calDaysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

// ---- earnings --------------------------------------------------------------
const _earnMemo = new Map<string, EarningsRow>();

export function earningsFor(symbol: string): EarningsRow {
  const key = symbol.toUpperCase();
  const hit = _earnMemo.get(key);
  if (hit) return hit;
  const u = lookup(key);
  const seed = seedFromSymbol(key);
  const r = rng(seed ^ 0x2545f491);
  const date = addBusinessDays(MOCK_TODAY, seed % 70); // 0..~14 weeks out
  const daysUntil = calDaysBetween(MOCK_TODAY, date);
  const time = (["bmo", "amc", "amc"] as const)[seed % 3];
  const epsEstimate = round(0.2 + r() * 4, 2);
  const stage = chartFor(key).stage;
  const whenTxt = daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
  const timeTxt = time === "bmo" ? "before the open" : "after the close";
  const row: EarningsRow = {
    symbol: key,
    name: u?.name ?? key,
    date,
    epsEstimate,
    time,
    daysUntil,
    stage,
    interpretation: {
      headline: `Reports ${whenTxt} ${timeTxt}`,
      tone: daysUntil <= 5 ? "warn" : "neutral",
      detail: `Consensus EPS $${epsEstimate.toFixed(2)}. ${daysUntil <= 5 ? "Close — expect a volatility event; watch guidance." : "On the calendar; no action needed yet."}`,
    },
  };
  _earnMemo.set(key, row);
  return row;
}

export function getEarnings(from?: string, to?: string): EarningsRow[] {
  const lo = from ?? MOCK_TODAY;
  const hi = to ?? addCalendarDays(MOCK_TODAY, 7);
  return UNIVERSE.map((u) => earningsFor(u.symbol))
    .filter((e) => e.date >= lo && e.date <= hi)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---- news ------------------------------------------------------------------
const NEWS_TEMPLATES: { t: string; s: Sentiment; src: string }[] = [
  { t: "%S beats quarterly estimates as demand accelerates", s: "pos", src: "MarketBeat" },
  { t: "Analyst raises %S price target on margin expansion", s: "pos", src: "The Street" },
  { t: "%S unveils new product line at investor day", s: "neutral", src: "Reuters" },
  { t: "%S faces pricing pressure in core segment", s: "neg", src: "Bloomberg" },
  { t: "%S insider selling draws scrutiny", s: "neg", src: "Barron's" },
  { t: "%S expands buyback program", s: "pos", src: "PR Newswire" },
];

export function getNews(symbol: string, limit = 10): NewsItem[] {
  const key = symbol.toUpperCase();
  const seed = seedFromSymbol(key);
  const r = rng(seed ^ 0x1b56c4e9);
  const stage = chartFor(key).stage;
  // bias sentiment toward the stage (uptrend → more positive headlines)
  const count = Math.min(limit, 6);
  const out: NewsItem[] = [];
  let d = MOCK_TODAY;
  for (let i = 0; i < count; i++) {
    d = addBusinessDays(d, -(1 + Math.floor(r() * 4)));
    let idx = Math.floor(r() * NEWS_TEMPLATES.length);
    if (stage === 2 && NEWS_TEMPLATES[idx].s === "neg" && r() < 0.6) idx = 0;
    if (stage === 4 && NEWS_TEMPLATES[idx].s === "pos" && r() < 0.6) idx = 3;
    const tpl = NEWS_TEMPLATES[idx];
    out.push({
      id: `${key}-${i}`,
      symbol: key,
      date: d,
      title: tpl.t.replace("%S", lookup(key)?.name ?? key),
      source: tpl.src,
      url: "#",
      sentiment: tpl.s,
      summary: `${tpl.s === "pos" ? "Constructive" : tpl.s === "neg" ? "Cautionary" : "Neutral"} coverage — one data point, not a thesis.`,
    });
  }
  return out;
}

// ---- concall ---------------------------------------------------------------
const LATEST_PERIOD = "Q3 2025";
const THEMES = [
  { theme: "Demand", pos: "Order book accelerated with broad-based strength.", neg: "Demand softened in the core segment." },
  { theme: "Margins", pos: "Gross margin expanded on better mix and pricing.", neg: "Margins compressed on input costs." },
  { theme: "Guidance", pos: "Management raised the full-year outlook.", neg: "Management trimmed full-year guidance." },
  { theme: "Capital", pos: "Buyback expanded; balance sheet remains strong.", neg: "Leverage ticked up amid heavier capex." },
];

// The stored Q3 2025 call reports in late Oct 2025 (before MOCK_TODAY) — a fixed,
// period-consistent date (deterministic).
const LATEST_CALL_DATE = "2025-10-22";

export function listTranscripts(symbol?: string): TranscriptMeta[] {
  const syms = symbol ? [symbol.toUpperCase()] : UNIVERSE.map((u) => u.symbol);
  return syms.map((s) => ({ symbol: s, period: LATEST_PERIOD, date: LATEST_CALL_DATE }));
}

function buildConcall(symbol: string, period: string, source: "stored" | "generated"): ConcallSummary {
  const key = symbol.toUpperCase();
  const stage = chartFor(key).stage;
  const bull = stage === 2 || stage === 1;
  const bullets = THEMES.map((t, i) => {
    const positive = bull ? i !== 3 || seedFromSymbol(key) % 2 === 0 : i === 0 ? seedFromSymbol(key) % 3 === 0 : false;
    return { theme: t.theme, text: positive ? t.pos : t.neg, tone: (positive ? "good" : "bad") as "good" | "bad" };
  });
  const sentiment: Sentiment = bull ? "pos" : stage === 4 ? "neg" : "neutral";
  return {
    symbol: key,
    period,
    date: LATEST_CALL_DATE,
    bullets,
    guidance: {
      headline: bull ? "Guidance raised" : sentiment === "neg" ? "Guidance cut" : "Guidance reaffirmed",
      tone: bull ? "good" : sentiment === "neg" ? "bad" : "neutral",
      detail: bull ? "Momentum into next quarter; execution is the watch item." : "Management is cautious near-term.",
    },
    sentiment,
    source,
    sourceNote: source === "stored" ? "Pre-ingested summary (heuristic)." : "Generated on demand from the provided text — heuristic, not investment advice.",
  };
}

export function getConcall(symbol: string, period: string): ConcallSummary | null {
  if (period !== LATEST_PERIOD) return null;
  return buildConcall(symbol, period, "stored");
}

export function summarizeConcall(input: { text: string } | { symbol: string; period: string }): ConcallSummary {
  if ("text" in input) {
    const t = input.text.trim();
    const pos = /(beat|record|raised|accelerat|strong|expand)/i.test(t);
    const neg = /(miss|weak|declin|cut|headwind|pressure|soft)/i.test(t);
    const sentiment: Sentiment = pos && !neg ? "pos" : neg && !pos ? "neg" : "neutral";
    return {
      symbol: null,
      period: null,
      date: MOCK_TODAY,
      bullets: THEMES.slice(0, 3).map((th) => ({ theme: th.theme, text: sentiment === "neg" ? th.neg : th.pos, tone: (sentiment === "neg" ? "bad" : "good") as "good" | "bad" })),
      guidance: { headline: sentiment === "pos" ? "Constructive tone" : sentiment === "neg" ? "Cautious tone" : "Mixed tone", tone: sentiment === "pos" ? "good" : sentiment === "neg" ? "bad" : "neutral", detail: `Heuristic read of ${t.length} characters — not investment advice.` },
      sentiment,
      source: "generated",
      sourceNote: "Generated on demand from pasted text — heuristic summary, not investment advice.",
    };
  }
  return buildConcall(input.symbol, input.period, "generated");
}

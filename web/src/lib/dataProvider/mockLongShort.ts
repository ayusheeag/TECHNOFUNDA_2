// Deterministic mock for the P/E re-rating long/short screen. Mirrors the API's
// logic (forward P/E = trailing / (1 + consensus growth); stage-gated; sane P/E
// band) over the fixed mock universe, so demo/dev mode shows a plausible screen.
import { chartFor } from "./mockChart";
import { MOCK_TODAY } from "./constants";
import { fundamentalsFor } from "./mockFundamentals";
import { UNIVERSE } from "./universe";
import type { Interpretation } from "@/lib/types";
import type { IndustryRerating, LongShortResponse, LongShortRow } from "./types";

function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000; // 0..1
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

function rowInterp(fwd: number, trail: number, rerate: number, rsHi: boolean, side: "long" | "short"): Interpretation {
  if (side === "long") {
    const rs = rsHi ? "; RS at a new high" : "";
    return {
      headline: `Forward P/E ~${Math.abs(rerate).toFixed(0)}% below trailing`,
      tone: "good",
      detail: `${trail.toFixed(0)}× → ${fwd.toFixed(0)}× — consensus points to higher EPS next quarter. Stage 2 uptrend${rs}. Room to re-rate up if the print confirms — consensus-implied, verify.`,
    };
  }
  return {
    headline: `Forward P/E ~${Math.abs(rerate).toFixed(0)}% above trailing`,
    tone: "bad",
    detail: `${trail.toFixed(0)}× → ${fwd.toFixed(0)}× — consensus points to lower EPS next quarter. Stage 4 downtrend. De-rating risk to the downside — consensus-implied, verify.`,
  };
}

type Base = LongShortRow & { _rerate: number; _stage: number };

function baseRow(u: (typeof UNIVERSE)[number]): Base | null {
  const chart = chartFor(u.symbol);
  const fund = fundamentalsFor(u.symbol);
  const trail = fund.peSeries[fund.peSeries.length - 1] ?? null;
  if (trail == null || trail < 8 || trail > 80) return null;
  const g = -0.35 + 0.8 * seed(u.symbol); // deterministic consensus growth
  const fwd = trail / (1 + g);
  if (fwd < 6 || fwd > 80) return null;
  const rerate = (fwd / trail - 1) * 100;
  if (rerate < -40 || rerate > 50) return null;
  const side = rerate < 0 ? "long" : "short";
  const stage = chart.stage ?? 3;
  const daysUntil = 1 + Math.floor(seed(u.symbol + "d") * 40);
  return {
    symbol: u.symbol,
    name: u.name,
    sector: u.sector,
    industry: u.industry,
    date: addDays(MOCK_TODAY, daysUntil),
    daysUntil,
    trailingPe: Math.round(trail * 10) / 10,
    forwardPe: Math.round(fwd * 10) / 10,
    reratePct: Math.round(rerate * 10) / 10,
    impliedEpsGrowth: Math.round((trail / fwd - 1) * 100 * 10) / 10,
    stage,
    rsNewHigh: chart.rsNewHigh,
    interpretation: rowInterp(fwd, trail, rerate, chart.rsNewHigh, side),
    _rerate: rerate,
    _stage: stage,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function industryRows(rows: Base[]): { grow: IndustryRerating[]; decline: IndustryRerating[] } {
  const by = new Map<string, Base[]>();
  for (const r of rows) by.set(r.industry, [...(by.get(r.industry) ?? []), r]);
  const aggs: IndustryRerating[] = [];
  for (const [industry, rs] of by) {
    if (rs.length < 2) continue;
    const med = median(rs.map((r) => r._rerate));
    const longs = rs.filter((r) => r._stage === 2 && r._rerate <= -6).length;
    const shorts = rs.filter((r) => r._stage === 4 && r._rerate >= 6).length;
    const grow = med < 0;
    aggs.push({
      industry,
      count: rs.length,
      medianReratePct: Math.round(med * 10) / 10,
      longs,
      shorts,
      interpretation: grow
        ? { headline: `${industry} — earnings momentum building`, tone: "good", detail: `Across ${rs.length} names, the median forward P/E compresses ~${Math.abs(med).toFixed(0)}% (${longs} Stage-2 long setups). Best-positioned of the group.` }
        : { headline: `${industry} — earnings momentum lagging`, tone: "warn", detail: `Median forward P/E expands ~${med.toFixed(0)}% across ${rs.length} names (${shorts} Stage-4 short setups). Weakest of the group.` },
    });
  }
  return {
    grow: aggs.slice().sort((a, b) => a.medianReratePct - b.medianReratePct).slice(0, 8),
    decline: aggs.slice().sort((a, b) => b.medianReratePct - a.medianReratePct).slice(0, 8),
  };
}

export function mockLongShort(top = 25): LongShortResponse {
  const rows = UNIVERSE.map(baseRow).filter((r): r is Base => r != null);
  const longs = rows
    .filter((r) => r._stage === 2 && r._rerate <= -6)
    .sort((a, b) => a._rerate - b._rerate)
    .slice(0, top);
  const shorts = rows
    .filter((r) => r._stage === 4 && r._rerate >= 6)
    .sort((a, b) => b._rerate - a._rerate)
    .slice(0, top);
  const strip = ({ _rerate, _stage, ...r }: Base): LongShortRow => r;
  const ind = industryRows(rows);
  return {
    longs: longs.map(strip),
    shorts: shorts.map(strip),
    industriesGrowing: ind.grow,
    industriesDeclining: ind.decline,
    meta: {
      asOf: MOCK_TODAY,
      universe: rows.length,
      method: "Forward P/E = price / (consensus quarterly EPS × 4), compared to trailing P/E; stage-gated. Consensus-implied — research, not investment advice.",
      disclaimer: "For research and educational purposes only — not investment advice.",
    },
  };
}

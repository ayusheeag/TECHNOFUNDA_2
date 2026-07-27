// Deterministic mock for the P/E re-rating long/short screen. Mirrors the API's
// logic (forward P/E = trailing / (1 + consensus growth); sane P/E band; sector
// bias demeaned vs market tilts the rank) over the fixed mock universe, so
// demo/dev mode shows a plausible screen.
import { chartFor } from "./mockChart";
import { MOCK_TODAY } from "./constants";
import { fundamentalsFor } from "./mockFundamentals";
import { UNIVERSE } from "./universe";
import type { Interpretation } from "@/lib/types";
import type { IndustryRerating, LongShortResponse, LongShortRow } from "./types";

const SECTOR_W = 0.5;

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
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
}

function sectorClause(sector: string, bias: number, side: "long" | "short"): string {
  if (side === "long") {
    if (bias <= -3) return ` ${sector} sector tailwind — re-rating ahead of the market.`;
    if (bias >= 3) return ` But ${sector} sector lags the market — lower conviction.`;
    return "";
  }
  if (bias >= 3) return ` ${sector} sector headwind — lagging the market — reinforces it.`;
  if (bias <= -3) return ` Note: ${sector} sector is strong — lower-conviction short.`;
  return "";
}

function rowInterp(fwd: number, trail: number, rerate: number, rsHi: boolean, sector: string, bias: number, side: "long" | "short"): Interpretation {
  const sec = sectorClause(sector, bias, side);
  if (side === "long") {
    const rs = rsHi ? " RS at a new high." : "";
    return {
      headline: `Forward P/E ~${Math.abs(rerate).toFixed(0)}% below trailing`,
      tone: "good",
      detail: `${trail.toFixed(0)}× → ${fwd.toFixed(0)}× — consensus points to higher EPS next quarter.${rs}${sec} Room to re-rate up if the print confirms — consensus-implied, verify.`,
    };
  }
  return {
    headline: `Forward P/E ~${Math.abs(rerate).toFixed(0)}% above trailing`,
    tone: "bad",
    detail: `${trail.toFixed(0)}× → ${fwd.toFixed(0)}× — consensus points to lower EPS next quarter.${sec} De-rating risk to the downside — consensus-implied, verify.`,
  };
}

type Raw = {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  date: string;
  daysUntil: number;
  trailingPe: number;
  forwardPe: number;
  reratePct: number;
  impliedEpsGrowth: number;
  rsNewHigh: boolean;
  stage: number;
};

function rawRow(u: (typeof UNIVERSE)[number]): Raw | null {
  const chart = chartFor(u.symbol);
  const fund = fundamentalsFor(u.symbol);
  const trail = fund.peSeries[fund.peSeries.length - 1] ?? null;
  if (trail == null || trail < 8 || trail > 80) return null;
  const g = -0.35 + 0.8 * seed(u.symbol); // deterministic consensus growth
  const fwd = trail / (1 + g);
  if (fwd < 6 || fwd > 80) return null;
  const rerate = (fwd / trail - 1) * 100;
  if (rerate < -40 || rerate > 50) return null;
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
    rsNewHigh: chart.rsNewHigh,
    stage: chart.stage ?? 3,
  };
}

function industryRows(rows: (LongShortRow & { _score: number })[]): { grow: IndustryRerating[]; decline: IndustryRerating[] } {
  const by = new Map<string, LongShortRow[]>();
  for (const r of rows) by.set(r.industry, [...(by.get(r.industry) ?? []), r]);
  const aggs: IndustryRerating[] = [];
  for (const [industry, rs] of by) {
    if (rs.length < 2) continue;
    const med = median(rs.map((r) => r.reratePct));
    const longs = rs.filter((r) => r.reratePct <= -6).length;
    const shorts = rs.filter((r) => r.reratePct >= 6).length;
    const grow = med < 0;
    aggs.push({
      industry,
      count: rs.length,
      medianReratePct: Math.round(med * 10) / 10,
      longs,
      shorts,
      interpretation: grow
        ? { headline: `${industry} — earnings momentum building`, tone: "good", detail: `Across ${rs.length} names, the median forward P/E compresses ~${Math.abs(med).toFixed(0)}% (${longs} long setups). Best-positioned of the group.` }
        : { headline: `${industry} — earnings momentum lagging`, tone: "warn", detail: `Median forward P/E expands ~${med.toFixed(0)}% across ${rs.length} names (${shorts} short setups). Weakest of the group.` },
    });
  }
  return {
    grow: aggs.slice().sort((a, b) => a.medianReratePct - b.medianReratePct).slice(0, 8),
    decline: aggs.slice().sort((a, b) => b.medianReratePct - a.medianReratePct).slice(0, 8),
  };
}

export function mockLongShort(top = 25): LongShortResponse {
  const raw = UNIVERSE.map(rawRow).filter((r): r is Raw => r != null);
  // Sector bias: sector median re-rating, demeaned vs the market.
  const marketMed = median(raw.map((r) => r.reratePct));
  const bySector = new Map<string, number[]>();
  for (const r of raw) bySector.set(r.sector, [...(bySector.get(r.sector) ?? []), r.reratePct]);
  const secMed = new Map<string, number>();
  for (const [s, xs] of bySector) secMed.set(s, median(xs));

  const rows = raw.map((r): LongShortRow & { _score: number } => {
    const bias = Math.round(((secMed.get(r.sector) ?? marketMed) - marketMed) * 10) / 10;
    const side = r.reratePct < 0 ? "long" : "short";
    const score = side === "long" ? -r.reratePct - SECTOR_W * bias + (r.rsNewHigh ? 8 : 0) : r.reratePct + SECTOR_W * bias;
    return {
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      industry: r.industry,
      date: r.date,
      daysUntil: r.daysUntil,
      trailingPe: r.trailingPe,
      forwardPe: r.forwardPe,
      reratePct: r.reratePct,
      impliedEpsGrowth: r.impliedEpsGrowth,
      sectorBias: bias,
      stage: r.stage,
      rsNewHigh: r.rsNewHigh,
      interpretation: rowInterp(r.forwardPe, r.trailingPe, r.reratePct, r.rsNewHigh, r.sector, bias, side),
      _score: score,
    };
  });

  const strip = ({ _score, ...r }: LongShortRow & { _score: number }): LongShortRow => r;
  const longs = rows.filter((r) => r.reratePct <= -6).sort((a, b) => b._score - a._score).slice(0, top).map(strip);
  const shorts = rows.filter((r) => r.reratePct >= 6).sort((a, b) => b._score - a._score).slice(0, top).map(strip);
  const ind = industryRows(rows);
  return {
    longs,
    shorts,
    industriesGrowing: ind.grow,
    industriesDeclining: ind.decline,
    meta: {
      asOf: MOCK_TODAY,
      universe: rows.length,
      sectorBase: rows.length,
      method: "Forward P/E = price / (consensus quarterly EPS × 4) vs trailing P/E, tilted by each sector's re-rating bias (demeaned vs the market). Consensus-implied — research, not investment advice.",
      disclaimer: "For research and educational purposes only — not investment advice.",
    },
  };
}

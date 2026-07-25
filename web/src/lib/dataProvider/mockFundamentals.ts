// Deterministic per-symbol fundamentals — a SECOND independent seed stream
// (seed ^ 0x9E3779B9) so revenue/EPS/PE move together but independently of the
// price path. Growth regime is biased by the price scenario, so a Stage-4 name
// does not accidentally show accelerating revenue. YoY is split-immune (null
// when the prior base <= 0), mirroring company._growth. No Date.now.
import { round } from "./analysis";
import { scenarioForSymbol } from "./mockChart";
import { rng, seedFromSymbol } from "./mockSeries";
import type { FinancialRow } from "./types";

export type GrowthRegime = "hyper" | "accelerating" | "steady" | "decel" | "contracting";

interface Profile {
  g: number; // base annual revenue growth
  gDrift: number; // per-year change in growth
  margin: number; // net margin
  peBase: number; // typical P/E
  peVol: number; // P/E dispersion (drives rerating percentile)
}
const PROFILE: Record<GrowthRegime, Profile> = {
  hyper: { g: 0.44, gDrift: -0.035, margin: 0.24, peBase: 55, peVol: 0.22 },
  accelerating: { g: 0.17, gDrift: 0.04, margin: 0.18, peBase: 34, peVol: 0.2 },
  steady: { g: 0.11, gDrift: 0.0, margin: 0.16, peBase: 24, peVol: 0.16 },
  decel: { g: 0.14, gDrift: -0.035, margin: 0.13, peBase: 21, peVol: 0.18 },
  contracting: { g: -0.05, gDrift: -0.015, margin: 0.06, peBase: 13, peVol: 0.24 },
};

function pickRegime(symbol: string, r: () => number): GrowthRegime {
  const s = scenarioForSymbol(symbol);
  if (s === "up") return r() < 0.5 ? "hyper" : "accelerating";
  if (s === "down") return "contracting";
  if (s === "choppy") return "decel";
  return "steady";
}

const CAP_TIERS = [8e9, 1.8e10, 4e10, 9e10, 2e11, 5e11, 1.2e12, 2.5e12];

/** YoY %, split-immune: null when there is no positive prior base. */
function yoy(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || prev <= 0) return null;
  return round((cur / prev - 1) * 100, 1);
}

function annualPeriods(): { period: string; reportDate: string }[] {
  // 5 reported fiscal years ending FY2024 (reported Feb 2025, before MOCK_TODAY).
  return [2020, 2021, 2022, 2023, 2024].map((y) => ({ period: `FY${y}`, reportDate: `${y + 1}-02-15` }));
}
function quarterlyPeriods(): { period: string; reportDate: string }[] {
  // 12 quarters ending Q3 2025.
  const ends: Record<number, string> = { 1: "-04-25", 2: "-07-24", 3: "-10-22", 4: "-01-28" };
  const out: { period: string; reportDate: string }[] = [];
  let y = 2022;
  let q = 4;
  for (let i = 0; i < 12; i++) {
    const ry = q === 4 ? y + 1 : y;
    out.push({ period: `Q${q} ${y}`, reportDate: `${ry}${ends[q]}` });
    q += 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
  }
  return out;
}

export interface Fundamentals {
  regime: GrowthRegime;
  marketCap: number;
  annual: FinancialRow[]; // oldest → newest (5)
  quarterly: FinancialRow[]; // oldest → newest (12)
  peSeries: number[]; // quarterly P/E, the rerating percentile input
  latest: {
    pe: number | null;
    evEbitda: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    roe: number | null;
    fcf: number | null;
    revenueYoY: number | null;
    epsYoY: number | null;
  };
}

const _memo = new Map<string, Fundamentals>();

export function fundamentalsFor(symbol: string): Fundamentals {
  const key = symbol.toUpperCase();
  const hit = _memo.get(key);
  if (hit) return hit;

  const r = rng((seedFromSymbol(key) ^ 0x9e3779b9) >>> 0);
  const regime = pickRegime(key, r);
  const p = PROFILE[regime];

  const marketCap = Math.round(CAP_TIERS[Math.floor(r() * CAP_TIERS.length)] * (0.7 + 0.6 * r()));
  const ps = 2 + 10 * r(); // price/sales anchor
  const shares = marketCap / (30 + 120 * r()); // for EPS scale
  const revLatest = marketCap / ps;

  // Annual growth path (5 years). Anchor the latest reported year to revLatest.
  const gA: number[] = [];
  for (let i = 0; i < 5; i++) gA.push(p.g + p.gDrift * i + (r() - 0.5) * 0.05);
  const revA: number[] = new Array(5);
  revA[4] = revLatest;
  for (let i = 3; i >= 0; i--) revA[i] = revA[i + 1] / (1 + gA[i + 1]);

  const marginPath = (i: number, n: number) => p.margin + (i / (n - 1) - 0.5) * 0.04 + (r() - 0.5) * 0.02;

  const aPer = annualPeriods();
  const annual: FinancialRow[] = revA.map((rev, i) => {
    const m = marginPath(i, 5);
    const eps = round((rev * m) / shares, 2);
    const gross = round(clampPct(m + 0.28 + (r() - 0.5) * 0.06), 1);
    const fcf = Math.round(rev * (m - 0.02 - r() * 0.03));
    return { period: aPer[i].period, reportDate: aPer[i].reportDate, revenue: Math.round(rev), revenueYoY: null, eps, epsYoY: null, grossMargin: gross, fcf };
  });
  for (let i = 0; i < annual.length; i++) {
    annual[i].revenueYoY = yoy(annual[i].revenue, annual[i - 1]?.revenue);
    annual[i].epsYoY = yoy(annual[i].eps, annual[i - 1]?.eps);
  }

  // Quarterly path (12): interpolate revenue with seasonality; PE mean-reverts.
  const qPer = quarterlyPeriods();
  const qRevBase = revA[3] / 4; // ~a year before latest annual, per quarter
  const quarterly: FinancialRow[] = [];
  const peSeries: number[] = [];
  let qrev = qRevBase;
  const qg = Math.pow(1 + Math.max(-0.4, gA[4]), 1 / 4) - 1; // quarterly compounding of latest annual growth
  for (let i = 0; i < 12; i++) {
    const season = 1 + 0.06 * Math.sin((i % 4) * 1.57);
    qrev = qrev * (1 + qg + (r() - 0.5) * 0.03);
    const rev = qrev * season;
    const m = marginPath(i, 12);
    const eps = round((rev * m) / shares, 2);
    const gross = round(clampPct(m + 0.28 + (r() - 0.5) * 0.06), 1);
    const fcf = Math.round(rev * (m - 0.02 - r() * 0.03));
    quarterly.push({ period: qPer[i].period, reportDate: qPer[i].reportDate, revenue: Math.round(rev), revenueYoY: null, eps, epsYoY: null, grossMargin: gross, fcf });
    const pe = round(p.peBase * (1 + (r() - 0.5) * 2 * p.peVol) * (1 + 0.2 * Math.sin(i)), 1);
    peSeries.push(Math.max(4, pe));
  }
  for (let i = 0; i < quarterly.length; i++) {
    quarterly[i].revenueYoY = yoy(quarterly[i].revenue, quarterly[i - 4]?.revenue);
    quarterly[i].epsYoY = yoy(quarterly[i].eps, quarterly[i - 4]?.eps);
  }

  const latestA = annual[annual.length - 1];
  const peNow = peSeries[peSeries.length - 1];
  const out: Fundamentals = {
    regime,
    marketCap,
    annual,
    quarterly,
    peSeries,
    latest: {
      pe: peNow,
      evEbitda: round(peNow * (0.55 + 0.2 * r()), 1),
      debtToEquity: round(0.2 + r() * 1.4, 2),
      currentRatio: round(1.0 + r() * 1.6, 2),
      roe: round(6 + r() * 30 * (regime === "contracting" ? 0.3 : 1), 1),
      fcf: latestA.fcf,
      revenueYoY: latestA.revenueYoY,
      epsYoY: latestA.epsYoY,
    },
  };
  _memo.set(key, out);
  return out;
}

function clampPct(x: number): number {
  return Math.max(0, Math.min(0.95, x)) * 100;
}

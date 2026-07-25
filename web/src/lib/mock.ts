/** Mock mode — lets the whole UI run with no API keys / no backend.
 *  Regimes: trending-up | trending-down | choppy. A dev toggle in the demo
 *  route flips between them so every component can be seen in each state. */
import type { CompositeScore, Interpretation, Stock } from "./types";

export type MockRegime = "up" | "down" | "choppy";

/** Deterministic pseudo-random so SSR and client render identically. */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function makeSpark(regime: MockRegime, n = 40, seed = 7): number[] {
  const r = rng(seed);
  const drift = regime === "up" ? 0.004 : regime === "down" ? -0.004 : 0;
  const vol = regime === "choppy" ? 0.02 : 0.012;
  let p = 100;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    p *= 1 + drift + (r() - 0.5) * vol * 2;
    out.push(Math.round(p * 100) / 100);
  }
  return out;
}

const interp = (headline: string, tone: Interpretation["tone"], detail?: string): Interpretation => ({ headline, tone, detail });

export function mockComposite(regime: MockRegime): CompositeScore {
  const strong = regime === "up";
  const weak = regime === "down";
  return {
    headline: strong ? 82 : weak ? 34 : 58,
    verdict: strong ? "Strong setup" : weak ? "Avoid — downtrend" : "Mixed — watch",
    technical: { value: strong ? 88 : weak ? 22 : 60, provisional: false, interpretation: interp(strong ? "Above all EMAs, RS-line at new high" : weak ? "Below 200-day, RS lagging" : "Above 200-day but stalling", strong ? "good" : weak ? "bad" : "neutral") },
    growth: { value: strong ? 79 : weak ? 40 : 55, provisional: false, interpretation: interp(strong ? "Revenue +34% YoY, earnings accelerating" : weak ? "Revenue growth decelerating" : "Steady low-teens growth", strong ? "good" : weak ? "neutral" : "neutral") },
    ownership: { value: strong ? 70 : null, provisional: !strong, interpretation: interp(strong ? "In the IBD 50 proxy" : "Not in the IBD 50 proxy — thin signal", strong ? "good" : "neutral", "Ownership uses the FFTY ETF proxy; a real 13F feed is planned.") },
    valuation: { value: strong ? 55 : weak ? 48 : 52, provisional: true, interpretation: interp("P/E in the middle of its own range", "neutral", "Per-name P/E is sparse on the free tier — provisional.") },
    interpretation: interp(strong ? "Act — the setup lines up" : weak ? "Avoid — the case is weak" : "Watch — it's mixed", strong ? "good" : weak ? "bad" : "warn", "Demo composite."),
  };
}

export function mockStocks(regime: MockRegime): Stock[] {
  const base: Array<Partial<Stock> & { symbol: string; name: string; sector: string }> = [
    { symbol: "NVDA", name: "NVIDIA Corp", sector: "Technology" },
    { symbol: "AMD", name: "Advanced Micro Devices", sector: "Technology" },
    { symbol: "LLY", name: "Eli Lilly & Co", sector: "Health Care" },
    { symbol: "MU", name: "Micron Technology", sector: "Technology" },
    { symbol: "MDGL", name: "Madrigal Pharmaceuticals", sector: "Health Care" },
    { symbol: "CLSK", name: "CleanSpark, Inc.", sector: "Financial Services" },
  ];
  return base.map((b, i) => {
    const reg: MockRegime = regime === "choppy" ? (i % 2 ? "up" : "down") : regime;
    const spark = makeSpark(reg, 40, i + 3);
    const changePct = reg === "up" ? 2.4 - i * 0.3 : reg === "down" ? -1.8 - i * 0.2 : (i % 2 ? 1.1 : -0.9);
    return {
      symbol: b.symbol, name: b.name, sector: b.sector,
      price: spark[spark.length - 1] * (1 + i * 0.4),
      changePct,
      marketCap: [5.07e12, 8.5e11, 1.07e12, 1.04e12, 4.1e10, 1.2e10][i],
      stage: (reg === "up" ? 2 : reg === "down" ? 4 : ((i % 4) + 1)) as Stock["stage"],
      rsNewHigh: reg === "up" && i < 2,
      spark,
      score: reg === "up" ? 82 - i * 5 : reg === "down" ? 40 - i * 3 : 58,
    };
  });
}

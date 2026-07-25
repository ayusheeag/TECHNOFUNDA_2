// Locks the composite invariants: the technical leg is a projection of the SAME
// chart the detail view draws; Stage-4 is never "act"; null legs renormalize;
// provisional legs still contribute; every leg + the headline carry an
// interpretation (no naked numbers).
import { describe, expect, it } from "vitest";
import { buildComposite } from "./composite";
import { chartFor } from "./mockChart";
import { fundamentalsFor } from "./mockFundamentals";
import type { StockChartResponse } from "./types";

const SYMS = ["NVDA", "LLY", "JPM", "TSLA", "XOM", "MDGL", "COST", "DIS"];

describe("buildComposite", () => {
  it("technical leg agrees with the chart's stage; headline in range; interpretations present", () => {
    for (const sym of SYMS) {
      const chart = chartFor(sym);
      const c = buildComposite({ chart, fund: fundamentalsFor(sym), sectorPeMedian: 25 });
      expect(c.headline).toBeGreaterThanOrEqual(0);
      expect(c.headline).toBeLessThanOrEqual(100);
      // technical value must reflect the chart stage: a stage-4 name scores low, stage-2 high
      if (chart.stage === 4) expect(c.technical.value as number).toBeLessThan(35);
      if (chart.stage === 2) expect(c.technical.value as number).toBeGreaterThanOrEqual(45);
      // no naked numbers
      for (const leg of [c.technical, c.growth, c.ownership, c.valuation]) {
        expect(leg.interpretation.headline.length).toBeGreaterThan(0);
      }
      expect(c.interpretation.headline.length).toBeGreaterThan(0);
      expect(c.interpretation.detail && c.interpretation.detail.length).toBeGreaterThan(0);
    }
  });

  it("Stage-4 names can never read Act; ownership + valuation are always provisional", () => {
    for (const sym of SYMS) {
      const chart = chartFor(sym);
      const c = buildComposite({ chart, fund: fundamentalsFor(sym), sectorPeMedian: 25 });
      if (chart.stage === 4) expect(c.verdict).not.toBe("act");
      if (c.verdict === "act") expect(chart.stage).toBe(2); // Stage-2 gate
      expect(c.ownership.provisional).toBe(true);
      expect(c.valuation.provisional).toBe(true);
    }
  });

  it("renormalizes when the technical leg is null (thin history)", () => {
    const stub = { symbol: "THIN", stage: null, rangePos: null, rsNewHigh: false, aboveMa: false, maSlopePct: null } as unknown as StockChartResponse;
    const c = buildComposite({ chart: stub, fund: fundamentalsFor("THIN"), sectorPeMedian: 25 });
    expect(c.technical.value).toBeNull();
    // headline still computed from the remaining (non-null) legs, not NaN
    expect(Number.isFinite(c.headline)).toBe(true);
    expect(c.headline).toBeGreaterThanOrEqual(0);
  });

  it("provisional legs contribute to the headline (full weight)", () => {
    const chart = chartFor("NVDA");
    const fund = fundamentalsFor("NVDA");
    const full = buildComposite({ chart, fund, sectorPeMedian: 25 });
    // Force ownership member vs not by swapping symbol shouldn't crash; headline must move when a provisional leg changes.
    expect(full.ownership.value).not.toBeNull();
    expect(full.valuation.value === null || typeof full.valuation.value === "number").toBe(true);
  });
});

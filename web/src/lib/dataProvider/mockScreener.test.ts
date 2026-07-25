// Parity: the screener score reproduces the Python formula
// (revenueYoY − pctBelowHigh*0.5 + rsNewHigh*10) and the rerating flag matches
// the rerating_scorecard rule. Also checks the chart⇔row invariant.
import { describe, expect, it } from "vitest";
import { buildScreenRow, getRerating, getScreenDefault, runScreen } from "./mockScreener";
import { chartFor } from "./mockChart";
import { round } from "./analysis";

describe("mockScreener", () => {
  it("score equals revenueYoY − pctBelowHigh*0.5 + rsNewHigh*10", () => {
    for (const sym of ["NVDA", "LLY", "XOM", "TSLA", "COST"]) {
      const r = buildScreenRow(sym);
      const expected = round((r.revenueYoY ?? 0) - (r.pctBelowHigh ?? 50) * 0.5 + (r.rsNewHigh ? 10 : 0), 1);
      expect(r.score).toBeCloseTo(expected, 1);
    }
  });

  it("row close/stage/rsNewHigh equal the shared chart (chart⇔row invariant)", () => {
    for (const sym of ["NVDA", "JPM", "MDGL"]) {
      const r = buildScreenRow(sym);
      const c = chartFor(sym);
      expect(r.close).toBe(c.close);
      expect(r.stage).toBe(c.stage);
      expect(r.rsNewHigh).toBe(c.rsNewHigh);
      expect(r.composite.technical.value === (c.stage == null ? null : r.composite.technical.value)).toBe(true);
    }
  });

  it("default screen is sorted by score desc; runScreen respects thresholds", () => {
    const def = getScreenDefault();
    for (let i = 1; i < def.length; i++) expect(def[i - 1].score).toBeGreaterThanOrEqual(def[i].score);
    const strict = runScreen({ minGrowth: 20, maxDE: 1.0, minCurrentRatio: 1.2 });
    for (const r of strict) {
      expect(r.revenueYoY ?? -999).toBeGreaterThanOrEqual(20);
      expect(r.debtToEquity ?? 999).toBeLessThanOrEqual(1.0);
      expect(r.currentRatio ?? 0).toBeGreaterThanOrEqual(1.2);
    }
  });

  it("rerating flag ⇒ cheap percentile, non-rich vs sector, accelerating positive growth", () => {
    for (const r of getRerating()) {
      if (r.flagged) {
        expect(r.pePctile as number).toBeLessThanOrEqual(50);
        expect(r.peVsSector ?? 0).toBeLessThanOrEqual(10);
        expect(r.revGrowthSlope).toBeGreaterThan(0);
        expect(r.revGrowthNow as number).toBeGreaterThan(0);
      }
    }
  });
});

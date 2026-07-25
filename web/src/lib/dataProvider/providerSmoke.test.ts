// Exercises the full provider surface so runtime errors in the derived mock
// modules (breadth EMA, sectors, earnings dates, detail assembly) surface here
// rather than in a page render.
import { describe, expect, it } from "vitest";
import { dataProvider } from "./index";

describe("provider surface smoke", () => {
  it("getMeta / getRegime — regime thresholds sane", async () => {
    const meta = await dataProvider.getMeta();
    expect(meta.universeSize).toBeGreaterThan(20);
    expect(meta.regime.pctAbove200ema).toBeGreaterThanOrEqual(0);
    expect(meta.regime.pctAbove200ema).toBeLessThanOrEqual(100);
    expect(["aggressive", "moderate", "shallow"]).toContain(meta.regime.regime);
    expect(meta.regime.interpretation.headline.length).toBeGreaterThan(0);
  });

  it("getBreadth — history has aligned sparks + regime per row", async () => {
    const b = await dataProvider.getBreadth();
    expect(b.rows.length).toBeGreaterThan(10);
    expect(b.pctSpark.length).toBe(b.rows.length);
    expect(b.nhSpark.length).toBe(b.rows.length);
    expect(b.latest.pctAbove200ema).toBe(b.rows[b.rows.length - 1].pctAbove200ema);
  });

  it("getSectors — 11 sectors, ranked by RSI desc, each with a chip + interpretation", async () => {
    const s = await dataProvider.getSectors();
    expect(s.length).toBe(11);
    for (let i = 1; i < s.length; i++) expect(s[i - 1].rsi14 ?? -1).toBeGreaterThanOrEqual(s[i].rsi14 ?? -1);
    for (const row of s) {
      expect(["sound", "stretched", "below-trend"]).toContain(row.chip);
      expect(row.interpretation.headline.length).toBeGreaterThan(0);
    }
  });

  it("getStockDetail agrees with getStockChart (chart⇔composite invariant)", async () => {
    for (const sym of ["NVDA", "XOM", "MDGL"]) {
      const d = await dataProvider.getStockDetail(sym);
      const c = await dataProvider.getStockChart(sym);
      expect(d.price).toBe(c.close);
      expect(d.stage).toBe(c.stage);
      expect(d.rsNewHigh).toBe(c.rsNewHigh);
      expect(d.composite.interpretation.headline.length).toBeGreaterThan(0);
    }
  });

  it("financials, valuation history, news, concall, earnings all produce interpreted data", async () => {
    const fin = await dataProvider.getFinancials("NVDA");
    expect(fin.annual.length).toBe(5);
    expect(fin.quarterly.length).toBe(12);
    expect(fin.interpretation.headline.length).toBeGreaterThan(0);
    const vh = await dataProvider.getValuationHistory("NVDA");
    expect(vh.length).toBe(12);
    const news = await dataProvider.getNews("NVDA");
    expect(news.length).toBeGreaterThan(0);
    const concall = await dataProvider.getConcall("NVDA", "Q3 2025");
    expect(concall?.bullets.length).toBeGreaterThan(0);
    const gen = await dataProvider.summarizeConcall({ text: "Record demand and raised guidance." });
    expect(gen.source).toBe("generated");
    const earn = await dataProvider.getEarnings({ from: "2025-10-31", to: "2026-03-01" });
    for (const e of earn) {
      expect(e.date >= "2025-10-31").toBe(true);
      expect(e.interpretation.headline.length).toBeGreaterThan(0);
    }
  });

  it("search + screener + rerating", async () => {
    const hits = await dataProvider.searchTickers("nv");
    expect(hits.some((h) => h.symbol === "NVDA")).toBe(true);
    const screen = await dataProvider.getScreenDefault();
    expect(screen.length).toBeGreaterThan(20);
    expect(screen.every((r) => r.interpretation.headline.length > 0)).toBe(true);
    const rr = await dataProvider.getRerating();
    expect(rr.length).toBeGreaterThan(0);
  });
});

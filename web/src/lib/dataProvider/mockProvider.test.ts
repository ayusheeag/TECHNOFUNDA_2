// Smoke test: the mock provider assembles a well-formed, deterministic payload
// whose full-cycle scenario visibly traverses all four Weinstein stages.
import { describe, expect, it } from "vitest";
import { dataProvider } from "./index";

describe("mockProvider payload", () => {
  it("is deterministic for a symbol", async () => {
    const a = await dataProvider.getStockChart("NVDA");
    const b = await dataProvider.getStockChart("NVDA");
    // meta.generatedAt is a wall-clock timestamp; everything else must match.
    expect({ ...a, meta: { ...a.meta, generatedAt: "" } }).toEqual({ ...b, meta: { ...b.meta, generatedAt: "" } });
  });

  it("full-cycle traverses all four stages with aligned arrays", async () => {
    const r = await dataProvider.getStockChart("DEMO", { regime: "full-cycle" });
    expect(r.bars.length).toBe(r.stageBars.length);
    expect(r.days).toBe(r.bars.length);
    expect(r.series.length).toBe(r.bars.length);
    const stages = new Set(r.stageSegments.map((s) => s.stage));
    expect([...stages].sort()).toEqual([1, 2, 3, 4]);
    // OHLC integrity
    for (const bar of r.bars) {
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.volume).toBeGreaterThan(0);
    }
    // latest scalars present + interpretation carries meaning (no naked numbers)
    expect(r.stage).not.toBeNull();
    expect(r.interpretation.headline.length).toBeGreaterThan(0);
    expect(r.interpretation.detail && r.interpretation.detail.length).toBeGreaterThan(0);
  });

  it("up regime leads (RS new high) and down regime does not", async () => {
    const up = await dataProvider.getStockChart("UP", { regime: "up" });
    const down = await dataProvider.getStockChart("DN", { regime: "down" });
    expect(up.rsNewHigh).toBe(true);
    expect(down.rsNewHigh).toBe(false);
  });

  it("is deterministic across regimes and repeated calls (same symbol → same close)", async () => {
    const a = await dataProvider.getStockChart("NVDA", { regime: "up" });
    const b = await dataProvider.getStockChart("NVDA", { regime: "up" });
    const c = await dataProvider.getStockChart("NVDA", { regime: "up" });
    expect(a.close).toBe(b.close);
    expect(b.close).toBe(c.close);
    expect(a.stage).toBe(2);
    // record the canonical value for NVDA/up so drift is visible in review
    console.log("[determinism] NVDA up close =", a.close, "days =", a.days, "rsNewHigh =", a.rsNewHigh);
  });
});

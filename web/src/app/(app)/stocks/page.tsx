import { dataProvider } from "@/lib/dataProvider";
import { StockCard } from "@/design-system";
import { StockSearch } from "@/components/StockSearch";
import type { Stock } from "@/lib/types";

export default async function StocksIndexPage() {
  const rows = await dataProvider.getScreenDefault();
  const popular = rows.slice(0, 8);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Research a stock</h1>
        <p className="mt-0.5 text-2xs text-muted">Search the covered universe, or start from a leader.</p>
      </div>
      <div className="mx-auto max-w-lg">
        <StockSearch autoFocus />
      </div>

      <section aria-labelledby="pop-h" className="space-y-2">
        <h2 id="pop-h" className="text-sm font-semibold text-text">Leaders right now</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {popular.map((r) => {
            const stock: Stock = {
              symbol: r.symbol,
              name: r.name,
              price: r.close,
              changePct: r.changePct,
              sector: r.sector,
              stage: r.stage,
              rsNewHigh: r.rsNewHigh,
              spark: r.spark,
              score: r.composite.headline,
            };
            return (
              <StockCard
                key={r.symbol}
                stock={stock}
                href={`/stocks/${r.symbol}`}
                verdict={r.composite.verdict === "act" ? "Act" : r.composite.verdict === "avoid" ? "Avoid" : "Watch"}
                reasons={[
                  { label: "Stage", value: String(r.stage ?? "—") },
                  { label: "Rev", value: r.revenueYoY == null ? "n/a" : `${r.revenueYoY >= 0 ? "+" : "−"}${Math.abs(r.revenueYoY).toFixed(0)}%` },
                  { label: "Score", value: r.score.toFixed(0) },
                ]}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

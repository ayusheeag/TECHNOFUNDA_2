import { dataProvider } from "@/lib/dataProvider";
import { MarketStatusBadge } from "@/design-system";
import { ChartDemoControls } from "./ChartDemoControls";

// Server Component: the mock/analysis math runs here and serializes plain JSON
// to the client — so ~0 bytes of generator/indicator code ship to the browser.
export default async function ChartDemoPage() {
  const initialSymbol = "NVDA";
  const initialRegime = "full-cycle" as const;
  const initialData = await dataProvider.getStockChart(initialSymbol, { regime: initialRegime });

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-2xs uppercase tracking-widest text-accent">TechnoFunda</div>
          <h1 className="text-base font-semibold text-text">Stock chart · /dev/chart</h1>
        </div>
        <MarketStatusBadge updatedAt={initialData.meta.generatedAt} />
      </div>
      <p className="mb-4 text-2xs text-muted">
        Weinstein-stage bands + relative-strength line, rendered with TradingView lightweight-charts and driven entirely by the
        mock dataProvider (no backend). Data source: <span className="font-medium text-text">{initialData.meta.source}</span>.
      </p>

      <ChartDemoControls initialData={initialData} initialSymbol={initialSymbol} initialRegime={initialRegime} />
    </main>
  );
}

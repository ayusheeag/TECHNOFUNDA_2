import type { StockChartResponse, StockDetailResponse } from "@/lib/dataProvider";
import { dataProvider } from "@/lib/dataProvider";
import { formatUSD, price } from "@/lib/format";
import { CompositeScoreCard, EmptyState, NewsCard, RegimeBadge, StageBadge, WatchStar, direction } from "@/design-system";
import { StockSearch } from "@/components/StockSearch";
import { FinancialsTabs } from "./FinancialsTabs";
import { ConcallSection } from "./ConcallSection";
import { ChartWithTimeframes } from "./ChartWithTimeframes";

export default async function StockDetailPage({ params }: { params: { symbol: string } }) {
  const symbol = params.symbol.toUpperCase();

  // Whether a symbol is covered is the provider's call (the real API knows the
  // full universe; the mock knows its own). Don't gate on a hardcoded list.
  let detail: StockDetailResponse;
  let chart: StockChartResponse;
  try {
    [detail, chart] = await Promise.all([dataProvider.getStockDetail(symbol), dataProvider.getStockChart(symbol)]);
  } catch {
    return (
      <div>
        <EmptyState icon="🔍" title={`We don't track ${symbol}`} description="Search the covered universe below." />
        <div className="mx-auto max-w-md">
          <StockSearch autoFocus />
        </div>
      </div>
    );
  }
  const [financials, news, concall, regime] = await Promise.all([
    dataProvider.getFinancials(symbol).catch(() => ({ symbol, annual: [], quarterly: [], interpretation: { headline: "Financials unavailable", tone: "neutral" as const, detail: null } })),
    dataProvider.getNews(symbol, { limit: 6 }).catch(() => []),
    dataProvider.getConcall(symbol, "Q3 2025").catch(() => null),
    dataProvider.getRegime().catch(() => null),
  ]);

  const d = direction(detail.changePct);

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-text">{detail.symbol}</h1>
            <StageBadge stage={detail.stage} />
            {regime && <RegimeBadge data={regime} variant="compact" />}
          </div>
          <p className="text-2xs text-muted">{detail.name} · {detail.sector} · {detail.industry}</p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="tnum text-hero font-semibold text-text">{price(detail.price)}</span>
            <span className={`tnum text-sm font-medium ${d.className}`}>
              <span aria-hidden>{d.arrow}</span> {d.sign}{Math.abs(detail.changePct).toFixed(2)}%
            </span>
            <span className="text-2xs text-faint">Mkt cap {formatUSD(detail.marketCap)}</span>
          </div>
        </div>
        <WatchStar symbol={detail.symbol} />
      </header>

      {/* The <10s answer */}
      <CompositeScoreCard composite={detail.composite} />

      {/* Corroboration: chart */}
      <section aria-labelledby="chart-h" className="space-y-1">
        <h2 id="chart-h" className="text-sm font-semibold text-text">Price &amp; trend</h2>
        <ChartWithTimeframes symbol={detail.symbol} initial={chart} />
      </section>

      {/* Financials */}
      <section aria-labelledby="fin-h" className="space-y-2">
        <h2 id="fin-h" className="text-sm font-semibold text-text">Financials</h2>
        <FinancialsTabs financials={financials} />
      </section>

      {/* Concall */}
      <section aria-labelledby="call-h" className="space-y-2">
        <h2 id="call-h" className="text-sm font-semibold text-text">Earnings call</h2>
        <ConcallSection symbol={detail.symbol} initial={concall} />
      </section>

      {/* News */}
      <section aria-labelledby="news-h" className="space-y-2">
        <h2 id="news-h" className="text-sm font-semibold text-text">Latest news</h2>
        {news.length === 0 ? (
          <EmptyState icon="📰" title="No recent news" />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {news.map((n) => (
              <NewsCard key={n.id} item={n} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

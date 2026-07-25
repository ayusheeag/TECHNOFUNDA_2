import { dataProvider } from "@/lib/dataProvider";
import { BreadthSparkCard, EmptyState, RegimeBadge, SectorLeaderboard } from "@/design-system";

export default async function PulsePage() {
  const [meta, breadth, sectors, industries] = await Promise.all([
    dataProvider.getMeta(),
    dataProvider.getBreadth(),
    dataProvider.getSectors(),
    dataProvider.getIndustryGrowth(),
  ]);

  if (meta.universeSize === 0) {
    return <EmptyState icon="◍" title="No market data yet" description="The nightly refresh hasn't run." />;
  }

  const b = breadth.latest;
  const topIndustries = industries.slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text">What&apos;s moving — and how big to size</h1>
        <p className="mt-0.5 text-2xs text-muted">{meta.summary.detail}</p>
      </div>

      <RegimeBadge data={meta.regime} />

      <section aria-labelledby="breadth-h" className="space-y-2">
        <h2 id="breadth-h" className="text-sm font-semibold text-text">Breadth</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <BreadthSparkCard
            title="% above 200-day EMA"
            series={breadth.pctSpark}
            latest={`${b.pctAbove200ema.toFixed(0)}`}
            suffix="%"
            interpretation={{
              headline: "Participation",
              tone: b.regime === "aggressive" ? "good" : b.regime === "shallow" ? "bad" : "neutral",
              detail: `${b.pctAbove200ema.toFixed(0)}% of the universe is in a long-term uptrend — a ${b.regime} tape.`,
            }}
          />
          <BreadthSparkCard
            title="Net new 52-week highs"
            series={breadth.nhSpark}
            latest={`${b.new52wHighs}`}
            interpretation={{
              headline: "Leadership count",
              tone: b.new52wHighs >= 6 ? "good" : b.new52wHighs <= 2 ? "bad" : "neutral",
              detail: `${b.new52wHighs} name${b.new52wHighs === 1 ? "" : "s"} at new highs — ${b.new52wHighs >= 6 ? "healthy expansion" : "narrow leadership"}.`,
            }}
          />
        </div>
      </section>

      <section aria-labelledby="sectors-h" className="space-y-2">
        <h2 id="sectors-h" className="text-sm font-semibold text-text">Sector leaderboard</h2>
        <p className="text-2xs text-muted">Ranked by ETF RSI — where the leadership is, and whether it&apos;s sound or stretched.</p>
        <SectorLeaderboard sectors={sectors} />
      </section>

      <section aria-labelledby="ind-h" className="space-y-2">
        <h2 id="ind-h" className="text-sm font-semibold text-text">Fastest-growing industries</h2>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {topIndustries.map((ind) => (
            <li key={ind.industry} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text">{ind.industry}</div>
                <div className="truncate text-2xs text-muted">{ind.sector} · {ind.breadthPctStage2}% in Stage 2</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="tnum text-sm font-semibold text-bull">
                  {ind.medianRevYoY == null ? "—" : `${ind.medianRevYoY >= 0 ? "+" : "−"}${Math.abs(ind.medianRevYoY).toFixed(0)}%`}
                </div>
                <div className="text-[10px] text-faint">median rev YoY</div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

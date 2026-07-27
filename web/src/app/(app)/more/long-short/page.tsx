import clsx from "clsx";
import Link from "next/link";
import { Disclaimer } from "@/design-system";
import { dataProvider } from "@/lib/dataProvider";
import type { IndustryRerating, LongShortRow } from "@/lib/dataProvider";

function StockRow({ r }: { r: LongShortRow }) {
  const compress = r.reratePct < 0; // fwd P/E below trailing = bullish
  const tone = compress ? "text-bull" : "text-bear";
  return (
    <li className="border-b border-border py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/stocks/${r.symbol}`} className="font-semibold text-text hover:text-accent">
            {r.symbol}
          </Link>
          <span className="truncate text-2xs text-muted">{r.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="tnum text-2xs text-muted">
            {r.trailingPe}× → {r.forwardPe}×
          </span>
          <span className={clsx("tnum text-xs font-semibold", tone)}>
            <span aria-hidden>{compress ? "▼" : "▲"}</span> {Math.abs(r.reratePct).toFixed(0)}%
          </span>
        </div>
      </div>
      <p className="mt-1 text-2xs leading-snug text-muted">
        <span className={clsx("font-medium", tone)}>{r.interpretation.headline}.</span> {r.interpretation.detail}
      </p>
      <div className="mt-0.5 text-[10px] text-faint">
        Reports in {r.daysUntil}d · {r.rsNewHigh ? "RS at a new high" : "RS below its high"}
      </div>
    </li>
  );
}

function StockPanel({ title, sub, rows, tone }: { title: string; sub: string; rows: LongShortRow[]; tone: "good" | "bad" }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={clsx("text-sm font-semibold", tone === "good" ? "text-bull" : "text-bear")}>{title}</h2>
        <span className="text-[10px] text-faint">{rows.length} names</span>
      </div>
      <p className="mt-0.5 text-2xs text-muted">{sub}</p>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-2xs text-faint">No qualifying setups in the current window.</p>
      ) : (
        <ul className="mt-2">
          {rows.map((r) => (
            <StockRow key={r.symbol} r={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function IndustryPanel({ title, sub, rows, tone }: { title: string; sub: string; rows: IndustryRerating[]; tone: "good" | "bad" }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h2 className={clsx("text-sm font-semibold", tone === "good" ? "text-bull" : "text-bear")}>{title}</h2>
      <p className="mt-0.5 text-2xs text-muted">{sub}</p>
      <ul className="mt-2 space-y-2">
        {rows.map((i) => {
          const compress = i.medianReratePct < 0;
          return (
            <li key={i.industry} className="border-b border-border pb-2 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text">{i.industry}</span>
                <span className={clsx("tnum text-xs font-semibold", compress ? "text-bull" : "text-bear")}>
                  <span aria-hidden>{compress ? "▼" : "▲"}</span> {Math.abs(i.medianReratePct).toFixed(0)}%
                </span>
              </div>
              <p className="mt-0.5 text-2xs leading-snug text-muted">{i.interpretation.detail}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function LongShortPage() {
  const data = await dataProvider.getLongShort({ window: 3, top: 20 }).catch(() => null);
  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text">Long / Short — P/E re-rating</h1>
        <p className="text-2xs text-muted">The screen is temporarily unavailable. Try again shortly.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Long / Short — P/E re-rating</h1>
        <p className="mt-0.5 text-2xs text-muted">
          Stocks reporting in the next ~3 days, ranked purely by how consensus re-rates the P/E — longs where forward P/E compresses (EPS rising), shorts where it expands (EPS falling). {data.meta.universe} names scored · as of {data.meta.asOf}. Near-term windows are naturally short and can be one-sided.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StockPanel title="Best longs" sub="Forward P/E below trailing — EPS momentum building" rows={data.longs} tone="good" />
        <StockPanel title="Best shorts" sub="Forward P/E above trailing — EPS momentum fading" rows={data.shorts} tone="bad" />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-text">Industry momentum</h2>
        <p className="mt-0.5 text-2xs text-muted">Median forward-P/E move across each industry&apos;s reporters — where earnings are collectively building vs. fading.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <IndustryPanel title="Best positioned to grow" sub="Strongest median P/E compression" rows={data.industriesGrowing} tone="good" />
        <IndustryPanel title="In decline / lagging" sub="Weakest — P/E expanding or barely compressing" rows={data.industriesDeclining} tone="bad" />
      </div>

      <p className="text-[10px] leading-relaxed text-faint">{data.meta.method}</p>
      <Disclaimer />
    </div>
  );
}

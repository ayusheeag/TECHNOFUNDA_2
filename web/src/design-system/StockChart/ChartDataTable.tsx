"use client";
import { useMemo, useState } from "react";
import type { StockChartResponse } from "@/lib/dataProvider";
import { compact, price } from "@/lib/format";
import { STAGE } from "../tokens";

/** Epoch-day bucket of 7 → "last bar of the week" downsample key. */
function weekKey(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000 / 7);
}

interface Row {
  i: number;
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  ma: number | null;
  stage: 1 | 2 | 3 | 4 | null;
  rs: number | null;
  newHigh: boolean;
}

/**
 * Accessible semantic-table fallback for the canvas. Every color cue has a text
 * equivalent (stage = glyph+word, RS-new-high = Yes/No). Wrapped in <details>
 * so it's reachable but not noisy; downsampled to weekly rows + the final bar +
 * every stage-transition bar, with a show-all toggle.
 */
export function ChartDataTable({ data }: { data: StockChartResponse }) {
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const rsByDate = new Map(data.rs.map((p) => [p.date, p]));
    const all: Row[] = data.bars.map((b, i) => {
      const rp = rsByDate.get(b.date);
      return {
        i,
        date: b.date,
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
        v: b.volume,
        ma: data.series[i]?.ma150 ?? null,
        stage: data.stageBars[i]?.stage ?? null,
        rs: rp?.rs ?? null,
        newHigh: rp?.newHigh ?? false,
      };
    });
    if (showAll) return all;
    const last = all.length - 1;
    return all.filter((r, i) => {
      if (i === last) return true; // final bar
      if (i > 0 && all[i].stage !== all[i - 1].stage) return true; // stage transition
      return weekKey(r.date) !== weekKey(all[i + 1].date); // last bar of the week
    });
  }, [data, showAll]);

  const th = "px-2 py-1 text-right font-medium text-faint";
  const td = "tnum px-2 py-1 text-right text-muted";

  return (
    <details className="mt-3 rounded-lg border border-border bg-surface">
      <summary className="min-h-touch flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-text marker:hidden">
        <span aria-hidden>▤</span> Show data table ({rows.length} rows)
      </summary>
      <div className="max-h-96 overflow-auto px-1 pb-2">
        <table className="w-full border-collapse text-2xs">
          <caption className="px-2 py-1 text-left text-2xs text-faint">
            {data.symbol} daily bars — downsampled to weekly plus stage transitions. Stage and RS-new-high are shown as text, not color.
          </caption>
          <thead className="sticky top-0 bg-surface">
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium text-faint">Date</th>
              <th scope="col" className={th}>Open</th>
              <th scope="col" className={th}>High</th>
              <th scope="col" className={th}>Low</th>
              <th scope="col" className={th}>Close</th>
              <th scope="col" className={th}>Volume</th>
              <th scope="col" className={th}>MA150</th>
              <th scope="col" className="px-2 py-1 text-left font-medium text-faint">Stage</th>
              <th scope="col" className={th}>RS</th>
              <th scope="col" className="px-2 py-1 text-left font-medium text-faint">RS new high</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-t border-border">
                <td className="tnum px-2 py-1 text-left text-muted">{r.date}</td>
                <td className={td}>{price(r.o)}</td>
                <td className={td}>{price(r.h)}</td>
                <td className={td}>{price(r.l)}</td>
                <td className="tnum px-2 py-1 text-right font-medium text-text">{price(r.c)}</td>
                <td className={td}>{compact(r.v)}</td>
                <td className={td}>{r.ma == null ? "—" : price(r.ma)}</td>
                <td className="px-2 py-1 text-left text-muted">
                  {r.stage == null ? "—" : `${STAGE[r.stage].glyph} ${STAGE[r.stage].label.split(" · ")[1] ?? r.stage}`}
                </td>
                <td className={td}>{r.rs == null ? "—" : r.rs.toFixed(4)}</td>
                <td className="px-2 py-1 text-left text-muted">{r.newHigh ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="min-h-touch mt-1 px-2 text-2xs font-medium text-accent hover:underline"
        >
          {showAll ? "Show weekly summary" : `Show all ${data.bars.length} rows`}
        </button>
      </div>
    </details>
  );
}

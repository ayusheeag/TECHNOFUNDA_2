"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { EarningsRow } from "@/lib/dataProvider";
import { StageBadge } from "./StageBadge";
import { EmptyState } from "./EmptyState";

const TIME: Record<EarningsRow["time"], string> = { bmo: "Before open", amc: "After close", unknown: "Time TBD" };

/** Native date-range pickers + a day-grouped, interpreted earnings list. Every
 *  row carries a plain-English "reports in N days" read. */
export function EarningsCalendar({ rows, from, to, onRange }: { rows: EarningsRow[]; from: string; to: string; onRange: (from: string, to: string) => void }) {
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const invalid = f > t;

  const groups = useMemo(() => {
    const m = new Map<string, EarningsRow[]>();
    for (const r of rows) {
      const g = m.get(r.date) ?? [];
      g.push(r);
      m.set(r.date, g);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [rows]);

  const apply = () => {
    if (!invalid) onRange(f, t);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-2xs text-muted">
          From
          <input type="date" value={f} onChange={(e) => setF(e.target.value)} onBlur={apply} aria-invalid={invalid} aria-describedby={invalid ? "date-err" : undefined} className="mt-0.5 block min-h-touch rounded-lg border border-border bg-surface px-2 text-sm text-text" />
        </label>
        <label className="text-2xs text-muted">
          To
          <input type="date" value={t} onChange={(e) => setT(e.target.value)} onBlur={apply} aria-invalid={invalid} aria-describedby={invalid ? "date-err" : undefined} className="mt-0.5 block min-h-touch rounded-lg border border-border bg-surface px-2 text-sm text-text" />
        </label>
        <button type="button" onClick={apply} disabled={invalid} className="min-h-touch rounded-lg bg-accent px-3 text-sm font-medium text-white disabled:opacity-60">
          Apply
        </button>
        {invalid && <span id="date-err" className="text-2xs text-bear">The start date must be on or before the end date.</span>}
      </div>

      {groups.length === 0 ? (
        <EmptyState icon="📅" title="No earnings between these dates" description="Widen the range to see upcoming reports." />
      ) : (
        <div className="space-y-3">
          {groups.map(([date, day]) => (
            <section key={date} aria-label={`Earnings on ${date}`}>
              <h3 className="tnum mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">{date}</h3>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {day.map((r) => (
                  <li key={r.symbol}>
                    <Link href={`/stocks/${r.symbol}`} className="flex min-h-touch items-center gap-3 px-3 py-2 hover:bg-surface-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-text">{r.symbol}</span>
                          <StageBadge stage={r.stage} size="sm" />
                          <span className="rounded bg-surface-2 px-1.5 text-[10px] text-muted">{TIME[r.time]}</span>
                        </div>
                        <div className="truncate text-2xs text-muted">{r.interpretation.detail ?? r.interpretation.headline}</div>
                      </div>
                      <div className="tnum shrink-0 text-right text-2xs text-muted">
                        {r.epsEstimate != null ? <>est <span className="font-medium text-text">${r.epsEstimate.toFixed(2)}</span></> : "—"}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

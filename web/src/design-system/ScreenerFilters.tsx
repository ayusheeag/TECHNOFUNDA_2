"use client";
import { useState } from "react";
import clsx from "clsx";
import type { ScreenFilters, Stage, Verdict } from "@/lib/dataProvider";
import { STAGE } from "./tokens";
import { BottomSheet } from "./BottomSheet";

const STAGES: Stage[] = [1, 2, 3, 4];
const VERDICTS: Verdict[] = ["act", "watch", "avoid"];

function toggle<T>(arr: T[] | undefined, v: T): T[] {
  const s = new Set(arr ?? []);
  s.has(v) ? s.delete(v) : s.add(v);
  return [...s];
}

/** Client-side filter bar — all changes apply over the already-loaded array
 *  (no round-trip). Stage/verdict/RS inline; industries in a bottom sheet. */
export function ScreenerFilters({ value, onChange, industries }: { value: ScreenFilters; onChange: (f: ScreenFilters) => void; industries: string[] }) {
  const [sheet, setSheet] = useState(false);
  const active = (value.stages?.length ?? 0) + (value.verdicts?.length ?? 0) + (value.industries?.length ?? 0) + (value.rsNewHighOnly ? 1 : 0) + (value.search ? 1 : 0) + (value.sector ? 1 : 0);

  const chip = (on: boolean) => clsx("min-h-touch rounded-full border px-2.5 text-2xs font-medium transition-colors", on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface-2 text-muted hover:text-text");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="search"
          value={value.search ?? ""}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
          placeholder="Filter by symbol or name"
          aria-label="Filter by symbol or name"
          className="min-h-touch min-w-[10rem] flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-faint focus-visible:border-accent"
        />
        <button type="button" onClick={() => setSheet(true)} className={chip((value.industries?.length ?? 0) > 0)}>
          Industries{value.industries?.length ? ` (${value.industries.length})` : ""}
        </button>
        {active > 0 && (
          <button type="button" onClick={() => onChange({})} className="min-h-touch px-2 text-2xs font-medium text-muted hover:text-text">
            Clear
          </button>
        )}
      </div>

      {value.sector && (
        <div>
          <button type="button" onClick={() => onChange({ ...value, sector: undefined })} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">
            Sector: {value.sector} <span aria-hidden>✕</span>
            <span className="sr-only">Clear sector filter</span>
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs text-faint">Stage</span>
        {STAGES.map((s) => (
          <button key={s} type="button" aria-pressed={value.stages?.includes(s) ?? false} onClick={() => onChange({ ...value, stages: toggle(value.stages, s) })} className={chip(value.stages?.includes(s) ?? false)}>
            <span aria-hidden>{STAGE[s].glyph}</span> {s}
          </button>
        ))}
        <span className="ml-2 text-2xs text-faint">Verdict</span>
        {VERDICTS.map((v) => (
          <button key={v} type="button" aria-pressed={value.verdicts?.includes(v) ?? false} onClick={() => onChange({ ...value, verdicts: toggle(value.verdicts, v) })} className={chip(value.verdicts?.includes(v) ?? false)}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
        <button type="button" aria-pressed={value.rsNewHighOnly ?? false} onClick={() => onChange({ ...value, rsNewHighOnly: !value.rsNewHighOnly })} className={clsx("ml-2", chip(value.rsNewHighOnly ?? false))}>
          RS at new high
        </button>
      </div>

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Filter by industry">
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {industries.map((ind) => {
            const on = value.industries?.includes(ind) ?? false;
            return (
              <label key={ind} className="flex min-h-touch cursor-pointer items-center gap-2 rounded px-2 text-sm text-text hover:bg-surface-2">
                <input type="checkbox" checked={on} onChange={() => onChange({ ...value, industries: toggle(value.industries, ind) })} className="h-4 w-4" />
                {ind}
              </label>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}

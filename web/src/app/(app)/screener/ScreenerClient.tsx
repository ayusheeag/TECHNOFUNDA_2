"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet, EmptyState, ScreenerFilters, ScreenerTable, SegmentedControl } from "@/design-system";
import { dataProvider, type ReratingRow, type ScreenFilters, type ScreenRow, type Verdict } from "@/lib/dataProvider";

function applyFilters(rows: ScreenRow[], f: ScreenFilters): ScreenRow[] {
  return rows.filter((r) => {
    if (f.sector && r.sector !== f.sector) return false;
    if (f.stages?.length && !(r.stage != null && f.stages.includes(r.stage))) return false;
    if (f.industries?.length && !f.industries.includes(r.industry)) return false;
    if (f.rsNewHighOnly && !r.rsNewHigh) return false;
    if (f.verdicts?.length && !f.verdicts.includes(r.composite.verdict as Verdict)) return false;
    if (f.search) {
      const q = f.search.toUpperCase();
      if (!(r.symbol.includes(q) || r.name.toUpperCase().includes(q))) return false;
    }
    return true;
  });
}

export function ScreenerClient({ ideas, rerating, industries, initialSector }: { ideas: ScreenRow[]; rerating: ReratingRow[]; industries: string[]; initialSector?: string }) {
  const router = useRouter();
  const [view, setView] = useState<"ideas" | "rerating">("ideas");
  const [filters, setFilters] = useState<ScreenFilters>(initialSector ? { sector: initialSector } : {});
  const [advanced, setAdvanced] = useState<ScreenRow[] | null>(null);
  const [appliedParams, setAppliedParams] = useState<{ minGrowth: number; maxDE: number; minCR: number } | null>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [minGrowth, setMinGrowth] = useState(15);
  const [maxDE, setMaxDE] = useState(1.5);
  const [minCR, setMinCR] = useState(1.0);
  const [running, setRunning] = useState(false);

  const base = advanced ?? ideas;
  const filtered = useMemo(() => applyFilters(base, filters), [base, filters]);
  const counts = useMemo(() => {
    const c = { act: 0, watch: 0, avoid: 0 };
    for (const r of filtered) c[r.composite.verdict as Verdict]++;
    return c;
  }, [filtered]);
  const rrShown = flaggedOnly ? rerating.filter((r) => r.flagged) : rerating;

  const runAdvanced = async () => {
    setRunning(true);
    try {
      const res = await dataProvider.runScreen({ minGrowth, maxDE, minCurrentRatio: minCR });
      setAdvanced(res);
      setAppliedParams({ minGrowth, maxDE, minCR }); // snapshot the params that produced THESE results
      setAdvOpen(false);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-text">The shortlist</h1>
          {view === "ideas" ? (
            <p className="tnum text-2xs text-muted" aria-live="polite">
              {filtered.length} pass{advanced ? " (custom screen)" : ""} — {counts.act} Act, {counts.watch} Watch, {counts.avoid} Avoid
            </p>
          ) : (
            <p className="tnum text-2xs text-muted">{rrShown.length} re-rating candidate{rrShown.length === 1 ? "" : "s"}</p>
          )}
        </div>
        <SegmentedControl
          options={[
            { value: "ideas", label: "Ideas" },
            { value: "rerating", label: "Re-rating" },
          ]}
          value={view}
          onChange={setView}
          size="sm"
          aria-label="Screener view"
        />
      </div>

      {view === "ideas" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <ScreenerFilters value={filters} onChange={setFilters} industries={industries} />
            </div>
            <button type="button" onClick={() => setAdvOpen(true)} className="min-h-touch shrink-0 self-start rounded-lg border border-border bg-surface-2 px-3 text-2xs font-medium text-muted hover:text-text">
              Advanced
            </button>
          </div>
          {advanced && appliedParams && (
            <div className="flex items-center justify-between rounded-lg border border-accent bg-accent-soft px-3 py-1.5 text-2xs text-accent">
              <span>Custom screen applied — growth ≥ {appliedParams.minGrowth}%, D/E ≤ {appliedParams.maxDE}, current ratio ≥ {appliedParams.minCR}.</span>
              <button type="button" onClick={() => { setAdvanced(null); setAppliedParams(null); }} className="font-medium underline">Reset</button>
            </div>
          )}
          {filtered.length === 0 ? (
            <EmptyState icon="🔎" title="No names match these filters" description="Loosen a filter to see more ideas." action={<button onClick={() => setFilters({})} className="min-h-touch rounded-lg bg-accent px-4 text-sm font-medium text-white">Clear filters</button>} />
          ) : (
            <ScreenerTable mode="ideas" rows={filtered} onSelect={(s) => router.push(`/stocks/${s}`)} />
          )}
        </>
      ) : (
        <>
          <label className="flex items-center gap-2 text-2xs text-muted">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} className="h-4 w-4" />
            Flagged setups only
          </label>
          {rrShown.length === 0 ? (
            <EmptyState icon="🪙" title="No re-rating setups today" description="Check back after earnings — re-rating needs cheap valuation plus improving growth." />
          ) : (
            <ScreenerTable mode="rerating" rows={rrShown} onSelect={(s) => router.push(`/stocks/${s}`)} />
          )}
        </>
      )}

      <BottomSheet open={advOpen} onClose={() => setAdvOpen(false)} title="Advanced screen">
        <div className="space-y-3">
          <NumField label="Min revenue growth (%)" value={minGrowth} onChange={setMinGrowth} step={5} />
          <NumField label="Max debt / equity" value={maxDE} onChange={setMaxDE} step={0.1} />
          <NumField label="Min current ratio" value={minCR} onChange={setMinCR} step={0.1} />
          <p className="text-2xs text-faint">Runs a bounded recompute over the universe (mirrors POST /screen).</p>
          <button type="button" onClick={runAdvanced} disabled={running} className="min-h-touch w-full rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60">
            {running ? "Screening…" : "Run screen"}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}

function NumField({ label, value, onChange, step }: { label: string; value: number; onChange: (n: number) => void; step: number }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-text">
      {label}
      <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} className="min-h-touch w-24 rounded-lg border border-border bg-surface px-2 text-right tnum text-text" />
    </label>
  );
}

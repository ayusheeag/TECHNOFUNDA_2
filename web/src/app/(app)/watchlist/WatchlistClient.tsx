"use client";
import { useMemo, useState } from "react";
import { BottomSheet, EmptyState, SegmentedControl, SkeletonLoader, WatchlistCard } from "@/design-system";
import { useWatchlist } from "@/hooks/useWatchlist";
import type { Verdict, WatchItem } from "@/lib/dataProvider";

type Sort = "earnings" | "verdict" | "added";
const V_ORDER: Record<Verdict, number> = { act: 0, watch: 1, avoid: 2 };

export function WatchlistClient({ suggestions }: { suggestions: { symbol: string; name: string }[] }) {
  const { items, loading, add, remove } = useWatchlist();
  const [sort, setSort] = useState<Sort>("earnings");
  const [addOpen, setAddOpen] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!items) return [];
    const copy = items.slice();
    if (sort === "earnings") copy.sort((a, b) => (a.nextEarnings?.daysUntil ?? 9999) - (b.nextEarnings?.daysUntil ?? 9999));
    else if (sort === "verdict") copy.sort((a, b) => V_ORDER[a.verdict] - V_ORDER[b.verdict]);
    return copy; // "added" keeps provider order (newest first)
  }, [items, sort]);

  const rollup = useMemo(() => {
    if (!items) return "";
    const reportingSoon = items.filter((i) => i.nextEarnings && i.nextEarnings.daysUntil <= 7).length;
    const stage2 = items.filter((i) => i.stage === 2).length;
    const bits = [`${items.length} tracked`];
    if (reportingSoon) bits.push(`${reportingSoon} report within a week`);
    if (stage2) bits.push(`${stage2} in a Stage-2 uptrend`);
    return bits.join(" · ");
  }, [items]);

  const doRemove = async (sym: string) => {
    await remove(sym);
    setUndo(sym);
    setTimeout(() => setUndo((u) => (u === sym ? null : u)), 5000);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy="true">
        <span className="sr-only" aria-live="polite">Loading your watchlist…</span>
        <SkeletonLoader variant="block" className="h-40" count={4} />
      </div>
    );
  }

  const watchedSet = new Set((items ?? []).map((i) => i.symbol));
  const freshSuggestions = suggestions.filter((s) => !watchedSet.has(s.symbol)).slice(0, 6);

  if (!items || items.length === 0) {
    return (
      <div>
        <EmptyState icon="⭐" title="Track your first name" description="Add a stock to see its stage, verdict and next earnings at a glance." />
        <div className="mx-auto flex max-w-md flex-wrap justify-center gap-2">
          {freshSuggestions.map((s) => (
            <button key={s.symbol} onClick={() => add(s.symbol)} className="min-h-touch rounded-lg border border-border bg-surface-2 px-3 text-sm font-medium text-text hover:border-accent">
              + {s.symbol}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-text">Watchlist</h1>
          <p className="text-2xs text-muted" aria-live="polite">{rollup}</p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            options={[
              { value: "earnings", label: "Earnings" },
              { value: "verdict", label: "Verdict" },
              { value: "added", label: "Added" },
            ]}
            value={sort}
            onChange={setSort}
            size="sm"
            aria-label="Sort watchlist"
          />
          <button onClick={() => setAddOpen(true)} className="min-h-touch rounded-lg bg-accent px-3 text-sm font-medium text-white">Add</button>
        </div>
      </div>

      {undo && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-2xs text-muted" role="status">
          <span>Removed {undo}.</span>
          <button onClick={() => { add(undo); setUndo(null); }} className="font-medium text-accent underline">Undo</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sorted.map((item: WatchItem) => (
          <WatchlistCard key={item.symbol} item={item} onRemove={doRemove} />
        ))}
      </div>

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a name">
        <div className="flex flex-wrap gap-2">
          {suggestions.filter((s) => !watchedSet.has(s.symbol)).map((s) => (
            <button key={s.symbol} onClick={() => { add(s.symbol); setAddOpen(false); }} className="min-h-touch rounded-lg border border-border bg-surface-2 px-3 text-sm font-medium text-text hover:border-accent">
              + {s.symbol} <span className="text-2xs text-faint">{s.name}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-2xs text-faint">Tip: on any stock page, tap the ★ to add it here.</p>
      </BottomSheet>
    </div>
  );
}

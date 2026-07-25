"use client";
import Link from "next/link";
import type { WatchItem } from "@/lib/dataProvider";
import { price } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import { StageBadge } from "./StageBadge";
import { TrendBadge } from "./TrendBadge";
import { VerdictChip } from "./VerdictChip";

/** A tracked name: identity + price + stage + verdict + next-earnings line —
 *  the "what needs attention next" surface. */
export function WatchlistCard({ item, onRemove }: { item: WatchItem; onRemove: (symbol: string) => void }) {
  const earn = item.nextEarnings;
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-elev-1">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/stocks/${item.symbol}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-text">{item.symbol}</span>
            <StageBadge stage={item.stage} size="sm" />
          </div>
          <div className="truncate text-2xs text-muted">{item.name}</div>
        </Link>
        <VerdictChip verdict={item.verdict} />
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="tnum text-lg font-semibold text-text">{price(item.close)}</div>
          <TrendBadge value={item.changePct} size="sm" />
        </div>
        <Sparkline data={item.spark} width={96} height={32} />
      </div>

      <div className="mt-2 border-t border-border pt-2 text-2xs">
        {earn ? (
          <span className="text-muted">
            {earn.interpretation.headline}
            {earn.epsEstimate != null && <span className="text-faint"> · est EPS ${earn.epsEstimate.toFixed(2)}</span>}
          </span>
        ) : (
          <span className="text-faint">No upcoming earnings scheduled</span>
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onRemove(item.symbol)}
          aria-label={`Remove ${item.symbol} from watchlist`}
          className="min-h-touch rounded px-2 text-2xs font-medium text-muted hover:text-bear"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

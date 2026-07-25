"use client";
import type { ReratingRow, ScreenRow } from "@/lib/dataProvider";
import { pct, price } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import { StageBadge } from "./StageBadge";
import { TrendBadge } from "./TrendBadge";
import { VerdictChip } from "./VerdictChip";
import { VirtualList } from "./VirtualList";

const ROW_H = 76;

type Props =
  | { mode: "ideas"; rows: ScreenRow[]; onSelect: (symbol: string) => void }
  | { mode: "rerating"; rows: ReratingRow[]; onSelect: (symbol: string) => void };

function IdeaRow({ r, onSelect }: { r: ScreenRow; onSelect: (s: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(r.symbol)}
      className="flex h-full w-full items-center gap-3 border-b border-border px-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-text">{r.symbol}</span>
          <StageBadge stage={r.stage} size="sm" />
          {r.rsNewHigh && <span className="rounded bg-accent-soft px-1 text-[10px] font-medium text-accent">RS↑</span>}
        </div>
        <div className="truncate text-2xs text-muted">{r.interpretation.headline}</div>
      </div>
      <Sparkline data={r.spark} width={84} height={30} className="hidden shrink-0 sm:block" />
      <div className="w-24 shrink-0 text-right">
        <div className="tnum text-sm font-semibold text-text">{price(r.close)}</div>
        <div className="mt-0.5 flex justify-end">
          <TrendBadge value={r.changePct} size="sm" variant="inline" />
        </div>
      </div>
      <div className="w-16 shrink-0 text-right">
        <VerdictChip verdict={r.composite.verdict} size="sm" />
        <div className="tnum mt-0.5 text-[10px] text-faint">score {r.score.toFixed(0)}</div>
      </div>
    </button>
  );
}

function ReratingRowView({ r, onSelect }: { r: ReratingRow; onSelect: (s: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(r.symbol)}
      className="flex h-full w-full items-center gap-3 border-b border-border px-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-text">{r.symbol}</span>
          {r.flagged && <span className="rounded-full bg-bull-soft px-1.5 text-[10px] font-medium text-bull">Re-rating</span>}
        </div>
        <div className="truncate text-2xs text-muted">{r.interpretation.detail ?? r.interpretation.headline}</div>
      </div>
      <Sparkline data={r.spark} width={84} height={30} className="hidden shrink-0 sm:block" />
      <div className="w-20 shrink-0 text-right">
        <div className="tnum text-sm font-semibold text-text">{r.pePctile == null ? "—" : `${r.pePctile}th`}</div>
        <div className="text-[10px] text-faint">P/E pctile</div>
      </div>
      <div className="w-16 shrink-0 text-right text-2xs">
        {r.peVsSector == null ? <span className="text-faint">—</span> : <span className={r.peVsSector <= 0 ? "text-bull" : "text-muted"}>{pct(r.peVsSector, 0)}</span>}
        <div className="text-[10px] text-faint">vs sector</div>
      </div>
    </button>
  );
}

/** Virtualized ranked list. >50 rows window through VirtualList (dependency-free);
 *  otherwise a plain list. Ideas and Re-rating swap column sets over one shell. */
export function ScreenerTable(props: Props) {
  const { rows, onSelect } = props;
  const render = (item: ScreenRow | ReratingRow) =>
    props.mode === "ideas" ? <IdeaRow r={item as ScreenRow} onSelect={onSelect} /> : <ReratingRowView r={item as ReratingRow} onSelect={onSelect} />;

  if (rows.length > 50) {
    return (
      <VirtualList
        items={rows as (ScreenRow | ReratingRow)[]}
        rowHeight={ROW_H}
        height={Math.min(640, rows.length * ROW_H)}
        renderRow={(item) => render(item)}
        onActivate={(i) => onSelect((rows[i] as { symbol: string }).symbol)}
        ariaLabel={props.mode === "ideas" ? "Screener results" : "Re-rating candidates"}
        className="rounded-lg border border-border bg-surface"
      />
    );
  }
  return (
    <ul className="overflow-hidden rounded-lg border border-border bg-surface" role="list" aria-label={props.mode === "ideas" ? "Screener results" : "Re-rating candidates"}>
      {(rows as (ScreenRow | ReratingRow)[]).map((item) => (
        <li key={(item as { symbol: string }).symbol} style={{ height: ROW_H }} role="listitem">
          {render(item)}
        </li>
      ))}
    </ul>
  );
}

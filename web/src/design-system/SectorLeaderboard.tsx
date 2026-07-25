import Link from "next/link";
import type { SectorScore } from "@/lib/dataProvider";
import { SectorChip } from "./SectorChip";

/** Sectors ranked by ETF RSI with a sound/stretched read — the "where's the
 *  leadership?" answer. Each row drills into that sector's constituents. */
export function SectorLeaderboard({ sectors }: { sectors: SectorScore[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {sectors.map((s, i) => (
        <li key={s.sector}>
          <Link
            href={`/screener?sector=${encodeURIComponent(s.sector)}`}
            className="flex min-h-touch items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
          >
            <span className="tnum w-5 shrink-0 text-2xs text-faint">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-text">{s.sector}</span>
                <span className="text-[10px] text-faint">{s.etf}</span>
                <SectorChip kind={s.chip} />
              </div>
              <div className="truncate text-2xs text-muted">{s.interpretation.detail}</div>
            </div>
            <div className="w-16 shrink-0 text-right">
              <div className="tnum text-sm font-semibold text-text">{s.rsi14 == null ? "—" : Math.round(s.rsi14)}</div>
              <div className="text-[10px] text-faint">RSI</div>
            </div>
            <div className="hidden w-24 shrink-0 text-right text-[10px] text-muted sm:block">
              {s.leaderSymbols.length ? `Leaders: ${s.leaderSymbols.join(", ")}` : ""}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

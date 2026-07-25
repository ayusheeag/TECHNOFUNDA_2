import type { StageSegment } from "@/lib/dataProvider";
import { STAGE } from "../tokens";

const DOT: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-faint",
  2: "bg-bull",
  3: "bg-warn",
  4: "bg-bear",
};

/** Static color+glyph+word key for the background stage bands — the colorblind-
 *  safe text encoding (stage is also text in the badge, markers and table). */
export function StageRibbonLegend({ segments }: { segments: StageSegment[] }) {
  const present = Array.from(new Set(segments.map((s) => s.stage))).sort() as (1 | 2 | 3 | 4)[];
  if (present.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
      <span className="text-faint">Stage bands:</span>
      {present.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-3 rounded-sm ${DOT[s]} opacity-40`} aria-hidden />
          <span aria-hidden>{STAGE[s].glyph}</span>
          {STAGE[s].label}
        </span>
      ))}
    </div>
  );
}

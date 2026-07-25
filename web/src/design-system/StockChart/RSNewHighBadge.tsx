import clsx from "clsx";
import { rsLeadership } from "@/lib/dataProvider/interpret";
import { TONE_CLASS } from "../tokens";

/** Plain-English RS-leadership pill. Stays visible even with the RS pane off, so
 *  the "is it leading?" answer never depends on the canvas (no naked numbers). */
export function RSNewHighBadge({ active, benchmarkSymbol }: { active: boolean; benchmarkSymbol: string }) {
  const copy = rsLeadership(active, benchmarkSymbol);
  const tone = TONE_CLASS[copy.tone];
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium", tone.bg, tone.text)}
      title={copy.detail ?? undefined}
    >
      <span aria-hidden>{active ? "▲" : "▬"}</span>
      {copy.headline}
    </span>
  );
}

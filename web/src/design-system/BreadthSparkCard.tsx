import clsx from "clsx";
import type { Interpretation } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { TONE_CLASS, direction } from "./tokens";

/** A labeled breadth trend: a taller, trend-coloured area chart + the latest
 *  value + the change over the window + a one-line read. */
export function BreadthSparkCard({
  title,
  series,
  latest,
  suffix = "",
  interpretation,
  className,
}: {
  title: string;
  series: number[];
  latest: string;
  suffix?: string;
  interpretation: Interpretation;
  className?: string;
}) {
  const t = TONE_CLASS[interpretation.tone];
  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? 0;
  const delta = Math.round((last - first) * 10) / 10;
  const d = direction(delta);

  return (
    <section aria-label={title} className={clsx("rounded-lg border border-border bg-surface p-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-2xs uppercase tracking-wide text-faint">{title}</div>
        <div className="text-right">
          <div className="tnum text-xl font-semibold text-text">
            {latest}
            <span className="text-2xs text-muted">{suffix}</span>
          </div>
          <div className={clsx("tnum flex items-center justify-end gap-0.5 text-[10px] font-medium", d.className)}>
            <span aria-hidden>{d.arrow}</span>
            {d.sign}
            {Math.abs(delta)}
            {suffix || " pts"} <span className="text-faint">over window</span>
          </div>
        </div>
      </div>
      {/* Auto-coloured by first→last direction; taller so the trend reads clearly. */}
      <Sparkline data={series} width={280} height={64} className="mt-2 w-full" />
      <p className={clsx("mt-1.5 text-2xs leading-snug", t.text)}>{interpretation.detail ?? interpretation.headline}</p>
    </section>
  );
}

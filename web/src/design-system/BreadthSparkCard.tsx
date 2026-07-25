import clsx from "clsx";
import type { Interpretation } from "@/lib/types";
import { Sparkline } from "./Sparkline";
import { TONE_CLASS } from "./tokens";

/** A labeled breadth sparkline + latest value + one-line trend read. */
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
  return (
    <section aria-label={title} className={clsx("rounded-lg border border-border bg-surface p-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-2xs uppercase tracking-wide text-faint">{title}</div>
        <div className="tnum text-lg font-semibold text-text">
          {latest}
          <span className="text-2xs text-muted">{suffix}</span>
        </div>
      </div>
      <Sparkline data={series} width={220} height={40} className="mt-1 w-full" tone="neutral" />
      <p className={clsx("mt-1 text-2xs leading-snug", t.text)}>{interpretation.detail ?? interpretation.headline}</p>
    </section>
  );
}

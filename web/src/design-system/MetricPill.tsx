import clsx from "clsx";
import type { Tone } from "./tokens";
import { TONE_CLASS } from "./tokens";

export interface MetricPillProps {
  label: string;
  /** The number/string — the headline value. */
  value: React.ReactNode;
  /** The plain-English interpretation — REQUIRED by the first principle:
   *  no naked numbers. e.g. "RSI 71 — overbought, momentum stretched". */
  interpretation: string;
  tone?: Tone;
  /** Provisional data (e.g. thin ownership/valuation) → dashed border + note. */
  provisional?: boolean;
  className?: string;
}

/** A metric with its meaning attached. This is the load-bearing component for
 *  "every metric carries a one-line plain-English interpretation." */
export function MetricPill({
  label, value, interpretation, tone = "neutral", provisional, className,
}: MetricPillProps) {
  const t = TONE_CLASS[tone];
  return (
    <div
      className={clsx(
        "rounded-lg border bg-surface p-3",
        provisional ? "border-dashed border-border" : "border-border",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xs uppercase tracking-wide text-faint">{label}</span>
        {provisional && (
          <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10px] text-faint" title="Inputs thin — provisional">
            provisional
          </span>
        )}
      </div>
      <div className={clsx("tnum mt-0.5 text-lg font-semibold", t.text)}>{value}</div>
      <p className="mt-1 text-xs leading-snug text-muted">{interpretation}</p>
    </div>
  );
}

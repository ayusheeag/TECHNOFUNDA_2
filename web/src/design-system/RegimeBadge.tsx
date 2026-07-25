import clsx from "clsx";
import type { RegimeResponse } from "@/lib/dataProvider";
import { REGIME, TONE_CLASS } from "./tokens";

/** Position-sizing posture from breadth. Hero variant leads the Pulse screen;
 *  compact variant sits in the Stock Detail header. Answers "how big should I
 *  size?" in one sentence — the number is carried in words. */
export function RegimeBadge({ data, variant = "hero", className }: { data: RegimeResponse; variant?: "hero" | "compact"; className?: string }) {
  const regime = data.regime;
  if (regime == null) {
    return (
      <div className={clsx("rounded-lg border border-dashed border-border bg-surface p-3 text-2xs text-muted", className)}>
        Regime unavailable — thin data. No posture inferred.
      </div>
    );
  }
  const meta = REGIME[regime];
  const t = TONE_CLASS[meta.tone === "good" ? "good" : meta.tone === "bad" ? "bad" : "neutral"];

  if (variant === "compact") {
    return (
      <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", t.bg, t.text, className)} title={data.sizingText}>
        <span aria-hidden>{data.icon}</span>
        {meta.label} regime
      </span>
    );
  }

  return (
    <section aria-label="Market regime" className={clsx("rounded-xl border p-4 shadow-elev-1", t.bg, "border-border", className)}>
      <div className="flex items-center gap-3">
        <span className="text-3xl" aria-hidden>{data.icon}</span>
        <div className="min-w-0">
          <div className={clsx("text-lg font-semibold", t.text)}>{meta.label} regime</div>
          <p className="mt-0.5 text-sm leading-relaxed text-text">{data.interpretation.detail}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
        <span className="tnum">
          <span className="text-faint">Above 200-day </span>
          <span className="font-medium text-text">{data.pctAbove200ema == null ? "—" : `${data.pctAbove200ema.toFixed(0)}%`}</span>
        </span>
        <span className="tnum">
          <span className="text-faint">New 52-wk highs </span>
          <span className="font-medium text-text">{data.new52wHighs}</span>
        </span>
        <span className="tnum">
          <span className="text-faint">Universe </span>
          <span className="font-medium text-text">{data.universeSize}</span>
        </span>
      </div>
    </section>
  );
}

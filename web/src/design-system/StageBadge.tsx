import clsx from "clsx";
import type { Stage } from "@/lib/dataProvider";
import { STAGE, TONE_CLASS } from "./tokens";

/** Weinstein stage chip — glyph + label + tone. Promotes the inline StockRow
 *  glyph to a labeled, colorblind-safe badge. */
export function StageBadge({ stage, size = "md", className }: { stage: Stage | null; size?: "sm" | "md"; className?: string }) {
  if (stage == null) {
    return <span className={clsx("inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-2xs text-faint", className)}>No stage</span>;
  }
  const s = STAGE[stage];
  const t = TONE_CLASS[s.tone === "good" ? "good" : s.tone === "bad" ? "bad" : s.tone === "warn" ? "warn" : "neutral"];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full font-medium",
        t.bg,
        t.text,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-2xs",
        className,
      )}
      title={s.label}
    >
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  );
}

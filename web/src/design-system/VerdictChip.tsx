import clsx from "clsx";
import type { Verdict } from "@/lib/dataProvider";
import { TONE_CLASS } from "./tokens";

const VERDICT: Record<Verdict, { word: string; glyph: string; tone: "good" | "warn" | "bad" }> = {
  act: { word: "Act", glyph: "▲", tone: "good" },
  watch: { word: "Watch", glyph: "◆", tone: "warn" },
  avoid: { word: "Avoid", glyph: "▼", tone: "bad" },
};

/** The recurring act/watch/avoid spine. Word + glyph + color, so the verdict
 *  survives grayscale (color is never the only signal). */
export function VerdictChip({ verdict, size = "md", className }: { verdict: Verdict | string; size?: "sm" | "md"; className?: string }) {
  const v = VERDICT[(verdict as Verdict) in VERDICT ? (verdict as Verdict) : "watch"];
  const t = TONE_CLASS[v.tone];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full font-semibold",
        t.bg,
        t.text,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-2xs",
        className,
      )}
    >
      <span aria-hidden>{v.glyph}</span>
      {v.word}
    </span>
  );
}

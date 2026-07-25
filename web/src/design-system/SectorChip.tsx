import clsx from "clsx";
import type { SoundChip } from "@/lib/dataProvider";
import { TONE_CLASS } from "./tokens";

const CHIP: Record<SoundChip, { word: string; glyph: string; tone: "good" | "warn" | "bad" }> = {
  sound: { word: "Sound", glyph: "✓", tone: "good" },
  stretched: { word: "Stretched", glyph: "!", tone: "warn" },
  "below-trend": { word: "Below trend", glyph: "▽", tone: "bad" },
};

/** Sector health: sound / stretched / below-trend. Word + glyph + color. */
export function SectorChip({ kind, className }: { kind: SoundChip; className?: string }) {
  const c = CHIP[kind];
  const t = TONE_CLASS[c.tone];
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", t.bg, t.text, className)}>
      <span aria-hidden>{c.glyph}</span>
      {c.word}
    </span>
  );
}

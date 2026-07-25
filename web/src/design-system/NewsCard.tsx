import clsx from "clsx";
import type { NewsItem } from "@/lib/dataProvider";
import { MOCK_TODAY } from "@/lib/dataProvider/constants";
import { TONE_CLASS } from "./tokens";

const SENT: Record<NewsItem["sentiment"], { word: string; tone: "good" | "neutral" | "bad" }> = {
  pos: { word: "Positive", tone: "good" },
  neutral: { word: "Neutral", tone: "neutral" },
  neg: { word: "Cautionary", tone: "bad" },
};

function daysAgo(iso: string): string {
  const d = Math.round((Date.parse(MOCK_TODAY) - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}

/** A news item with a sentiment chip (word + color) — never color alone. */
export function NewsCard({ item }: { item: NewsItem }) {
  const s = SENT[item.sentiment];
  const t = TONE_CLASS[s.tone];
  return (
    <article className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium leading-snug text-text">{item.title}</h3>
        <span className={clsx("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", t.bg, t.text)}>{s.word}</span>
      </div>
      <p className="mt-1 text-2xs text-muted">{item.summary}</p>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-faint">
        <span>{item.source}</span>
        <span aria-hidden>·</span>
        <span>{daysAgo(item.date)}</span>
      </div>
    </article>
  );
}

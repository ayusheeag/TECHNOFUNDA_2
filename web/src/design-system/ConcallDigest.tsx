"use client";
import { useState } from "react";
import clsx from "clsx";
import type { ConcallSummary } from "@/lib/dataProvider";
import { TONE_CLASS } from "./tokens";
import { EmptyState } from "./EmptyState";

const DOT: Record<"good" | "neutral" | "bad" | "warn", string> = { good: "bg-bull", neutral: "bg-faint", bad: "bg-bear", warn: "bg-warn" };
const SENT: Record<ConcallSummary["sentiment"], { word: string; tone: "good" | "neutral" | "bad" }> = {
  pos: { word: "Constructive", tone: "good" },
  neutral: { word: "Mixed", tone: "neutral" },
  neg: { word: "Cautious", tone: "bad" },
};

/** Earnings-call digest: bullet themes + guidance read + summarize-on-demand.
 *  The summary is labeled stored vs generated (never presented as fact). */
export function ConcallDigest({ summary, onSummarize, className }: { summary: ConcallSummary | null; onSummarize?: () => Promise<void>; className?: string }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!onSummarize) return;
    setBusy(true);
    try {
      await onSummarize();
    } finally {
      setBusy(false);
    }
  };

  if (!summary) {
    return (
      <div className={className}>
        <EmptyState icon="🗒" title="No stored call summary" description="Summarize the latest transcript on demand (heuristic — not investment advice)." />
        {onSummarize && (
          <div className="flex justify-center">
            <button type="button" onClick={run} disabled={busy} className="min-h-touch rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60">
              {busy ? "Summarizing…" : "Summarize latest call"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const sent = SENT[summary.sentiment];
  const t = TONE_CLASS[sent.tone];
  return (
    <div className={clsx("rounded-lg border border-border bg-surface p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text">
          Earnings call {summary.period ? <span className="text-muted">· {summary.period}</span> : ""}
        </div>
        <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-medium", t.bg, t.text)}>{sent.word}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {summary.bullets.map((b) => (
          <li key={b.theme} className="flex items-start gap-2 text-xs">
            <span className={clsx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", DOT[b.tone])} aria-hidden />
            <span>
              <span className="font-medium text-text">{b.theme}: </span>
              <span className="text-muted">{b.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 border-t border-border pt-2 text-2xs text-muted">
        <span className="font-medium text-text">{summary.guidance.headline}. </span>
        {summary.guidance.detail}
      </p>
      <p className="mt-1 text-[10px] italic text-faint">{summary.sourceNote}</p>
      {onSummarize && summary.source === "stored" && (
        <button type="button" onClick={run} disabled={busy} className="min-h-touch mt-1 text-2xs font-medium text-accent hover:underline disabled:opacity-60">
          {busy ? "Re-summarizing…" : "Re-summarize on demand"}
        </button>
      )}
    </div>
  );
}

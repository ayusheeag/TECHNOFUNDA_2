"use client";
import { useState } from "react";
import { ConcallDigest, EmptyState } from "@/design-system";
import { dataProvider, type ConcallSummary, type TranscriptMeta } from "@/lib/dataProvider";

export function ConcallToolClient({ transcripts }: { transcripts: TranscriptMeta[] }) {
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<ConcallSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const summarizePasted = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setSummary(await dataProvider.summarizeConcall({ text }));
    } finally {
      setBusy(false);
    }
  };

  const loadStored = async (symbol: string) => {
    if (!symbol) return;
    setBusy(true);
    try {
      setSummary(await dataProvider.getConcall(symbol, "Q3 2025"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="concall-text" className="text-sm font-medium text-text">Paste a transcript</label>
        <textarea
          id="concall-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Paste earnings-call text here…"
          className="w-full rounded-lg border border-border bg-surface p-3 text-sm text-text placeholder:text-faint focus-visible:border-accent"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={summarizePasted} disabled={busy || !text.trim()} className="min-h-touch rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-60">
            {busy ? "Summarizing…" : "Summarize text"}
          </button>
          <span className="text-2xs text-faint">or</span>
          <label className="text-2xs text-muted">
            Load a stored call
            <select onChange={(e) => loadStored(e.target.value)} defaultValue="" className="ml-2 min-h-touch rounded-lg border border-border bg-surface px-2 text-sm text-text">
              <option value="" disabled>Pick a symbol…</option>
              {transcripts.map((t) => (
                <option key={t.symbol} value={t.symbol}>{t.symbol} · {t.period}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {summary ? <ConcallDigest summary={summary} /> : <EmptyState icon="🗒" title="No summary yet" description="Paste a transcript or pick a stored call above." />}
    </div>
  );
}

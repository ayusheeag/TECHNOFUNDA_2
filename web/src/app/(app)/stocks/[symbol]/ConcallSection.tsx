"use client";
import { useState } from "react";
import { ConcallDigest } from "@/design-system";
import { dataProvider, type ConcallSummary } from "@/lib/dataProvider";

const PERIOD = "Q3 2025";

export function ConcallSection({ symbol, initial }: { symbol: string; initial: ConcallSummary | null }) {
  const [summary, setSummary] = useState<ConcallSummary | null>(initial);
  const onSummarize = async () => {
    const s = await dataProvider.summarizeConcall({ symbol, period: PERIOD });
    setSummary(s);
  };
  return <ConcallDigest summary={summary} onSummarize={onSummarize} />;
}

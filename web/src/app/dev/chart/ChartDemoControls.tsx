"use client";
import { useRef, useState } from "react";
import { StockChart } from "@/design-system";
import { SegmentedControl } from "@/design-system";
import type { StockChartResponse } from "@/lib/dataProvider";
import { ThemeToggle } from "@/components/ThemeToggle";

type Regime = "full-cycle" | "up" | "down" | "choppy";

const SYMBOLS = ["NVDA", "AMD", "LLY", "MDGL", "DEMO"];
const REGIMES: { value: Regime; label: string }[] = [
  { value: "full-cycle", label: "Full cycle" },
  { value: "up", label: "Uptrend" },
  { value: "down", label: "Downtrend" },
  { value: "choppy", label: "Choppy" },
];

export function ChartDemoControls({
  initialData,
  initialSymbol,
  initialRegime,
}: {
  initialData: StockChartResponse;
  initialSymbol: string;
  initialRegime: Regime;
}) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [regime, setRegime] = useState<Regime>(initialRegime);
  const [data, setData] = useState<StockChartResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  async function load(nextSymbol: string, nextRegime: Regime) {
    const id = ++reqId.current; // sequence token — drop stale responses
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/chart?symbol=${encodeURIComponent(nextSymbol)}&regime=${nextRegime}`);
      if (id !== reqId.current) return; // a newer request superseded this one
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData((await res.json()) as StockChartResponse);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : "Failed to load chart data.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSymbol(s);
                load(s, regime);
              }}
              aria-pressed={s === symbol}
              className={
                "min-h-touch rounded-lg border px-2.5 text-xs font-medium transition-colors " +
                (s === symbol ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface-2 text-muted hover:text-text")
              }
            >
              {s}
            </button>
          ))}
        </div>
        <SegmentedControl
          options={REGIMES}
          value={regime}
          onChange={(r) => {
            setRegime(r);
            load(symbol, r);
          }}
          size="sm"
          aria-label="Mock price regime"
        />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      <StockChart data={data} loading={loading} error={error} />
    </div>
  );
}

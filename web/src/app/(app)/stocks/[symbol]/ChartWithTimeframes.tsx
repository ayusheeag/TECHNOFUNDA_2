"use client";
import { useRef, useState } from "react";
import { SegmentedControl, StockChart } from "@/design-system";
import { ChartErrorBoundary } from "@/design-system/StockChart/ChartErrorBoundary";
import { dataProvider, type StockChartResponse, type Timeframe } from "@/lib/dataProvider";

const TFS: { value: Timeframe; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
];

/** Wraps the chart with a timeframe switcher. The initial (daily) payload is
 *  server-rendered; switching refetches for that timeframe. The selector shows
 *  only when the data is real (the mock is daily-only). */
export function ChartWithTimeframes({ symbol, initial }: { symbol: string; initial: StockChartResponse }) {
  const [tf, setTf] = useState<Timeframe>(initial.meta.timeframe ?? "1d");
  const [data, setData] = useState<StockChartResponse>(initial);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const showSelector = initial.meta.source === "api";

  const onTf = async (next: Timeframe) => {
    setTf(next);
    if (next === (data.meta.timeframe ?? "1d")) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const d = await dataProvider.getStockChart(symbol, { timeframe: next });
      if (id === reqId.current) setData(d);
    } catch {
      /* keep the current chart */
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {showSelector && (
        <div className="flex justify-end">
          <SegmentedControl options={TFS} value={tf} onChange={onTf} size="sm" aria-label="Chart timeframe" />
        </div>
      )}
      <ChartErrorBoundary key={tf}>
        <StockChart data={data} loading={loading} />
      </ChartErrorBoundary>
    </div>
  );
}

"use client";
import { useEffect, useId, useState } from "react";
import type { ComponentType } from "react";
import type { CrosshairPayload, StockChartResponse } from "@/lib/dataProvider";
import { STAGE_MIN_BARS } from "@/lib/dataProvider/analysis";
import { Disclaimer } from "../Disclaimer";
import { EmptyState } from "../EmptyState";
import { useChartTheme } from "./useChartTheme";
import { ChartHeader } from "./ChartHeader";
import { ChartSkeleton } from "./ChartSkeleton";
import { ChartAriaSummary } from "./ChartAriaSummary";
import { ChartDataTable } from "./ChartDataTable";
import { CrosshairReadout } from "./CrosshairReadout";
import { StageRibbonLegend } from "./StageRibbonLegend";
import type { ChartCanvasProps } from "./ChartCanvas";

export interface StockChartProps {
  data: StockChartResponse | null;
  loading?: boolean;
  error?: string | null;
  height?: number;
  showVolume?: boolean;
  showRS?: boolean;
  onCrosshairChange?: (p: CrosshairPayload | null) => void;
  className?: string;
}

/**
 * Top-level chart. Owns the loading/empty/error/ready state machine and the
 * a11y <figure>. The lightweight-charts canvas is imported ONLY on the client
 * and ONLY when data is ready — so the lib lives in a lazy chunk, never in
 * First Load JS and never on the server.
 */
export function StockChart({
  data,
  loading = false,
  error = null,
  height = 460,
  showVolume = true,
  showRS: showRSInitial = true,
  onCrosshairChange,
  className,
}: StockChartProps) {
  const tokens = useChartTheme();
  const [showRS, setShowRS] = useState(showRSInitial);
  const [crosshair, setCrosshair] = useState<CrosshairPayload | null>(null);
  const [Canvas, setCanvas] = useState<ComponentType<ChartCanvasProps> | null>(null);
  const capId = useId();
  const sumId = useId();

  const ready = !error && !loading && data != null && data.bars.length > 0 && data.days >= STAGE_MIN_BARS;

  // Lazy-load the canvas chunk once, only when we actually have a chart to draw.
  useEffect(() => {
    if (!ready || Canvas) return;
    let alive = true;
    import("./ChartCanvas").then((m) => alive && setCanvas(() => m.default));
    return () => {
      alive = false;
    };
  }, [ready, Canvas]);

  if (error) {
    return (
      <div className={className}>
        <EmptyState icon="⚠" title="Couldn't load chart" description={error} />
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className={className}>
        <ChartSkeleton height={height} />
      </div>
    );
  }
  if (data.bars.length === 0 || data.days < STAGE_MIN_BARS) {
    return (
      <div className={className}>
        <ChartHeaderless symbol={data.symbol} />
        <EmptyState
          icon="◔"
          title="Not enough price history for a stage read"
          description={`Weinstein stage analysis needs ${STAGE_MIN_BARS} daily sessions; this symbol has ${data.days}.`}
        />
        <Disclaimer className="mt-2" />
      </div>
    );
  }

  const handleCrosshair = (p: CrosshairPayload | null) => {
    setCrosshair(p);
    onCrosshairChange?.(p);
  };

  return (
    <figure role="group" aria-labelledby={capId} aria-describedby={sumId} className={className}>
      <figcaption id={capId} className="sr-only">
        {data.symbol} daily price chart with Weinstein stage bands and relative-strength line.
      </figcaption>
      <ChartAriaSummary data={data} id={sumId} />

      <ChartHeader data={data} showRS={showRS} onToggleRS={() => setShowRS((v) => !v)} />

      {Canvas ? (
        <Canvas
          data={data}
          height={height}
          showVolume={showVolume}
          showRS={showRS}
          tokens={tokens}
          onCrosshairChange={handleCrosshair}
        />
      ) : (
        <ChartSkeleton height={height} />
      )}

      <CrosshairReadout payload={crosshair} />
      <StageRibbonLegend segments={data.stageSegments} />
      <ChartDataTable data={data} />
      <Disclaimer className="mt-3" />
    </figure>
  );
}

function ChartHeaderless({ symbol }: { symbol: string }) {
  return <div className="mb-1 text-base font-bold text-text">{symbol}</div>;
}

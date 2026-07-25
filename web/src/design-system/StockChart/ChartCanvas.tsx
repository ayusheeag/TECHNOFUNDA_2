"use client";
// The ONLY lightweight-charts consumer. Loaded via next/dynamic(ssr:false) from
// StockChart, so the lib sits in a lazy async chunk — never in First Load JS,
// never evaluated on the server. Owns init / 2 panes / setData / resize /
// theme-apply / teardown. All lib coupling lives here + StageBandPrimitive.
import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { CrosshairPayload, StockChartResponse } from "@/lib/dataProvider";
import { buildCrosshairSentence, pctVsMa } from "@/lib/dataProvider/interpret";
import { stageColor, type ChartThemeTokens } from "./chartTheme";
import { StageBandPrimitive } from "./StageBandPrimitive";

export interface ChartCanvasProps {
  data: StockChartResponse;
  height: number;
  showVolume: boolean;
  showRS: boolean;
  tokens: ChartThemeTokens;
  onCrosshairChange?: (p: CrosshairPayload | null) => void;
}

function timeToISO(t: Time): string {
  if (typeof t === "string") return t;
  if (typeof t === "number") return new Date(t * 1000).toISOString().slice(0, 10);
  const b = t as { year: number; month: number; day: number };
  return `${b.year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;
}

/** Stage-transition markers (colored by the current tokens). Rebuilt on theme flip. */
function stageMarkersOf(data: StockChartResponse, t: ChartThemeTokens): SeriesMarker<Time>[] {
  return data.stageSegments
    .slice(1)
    .map((seg) => ({ time: seg.startDate as Time, position: "aboveBar", shape: "circle", color: stageColor(seg.stage, t), text: String(seg.stage) }));
}

function rsMarkersOf(data: StockChartResponse, t: ChartThemeTokens): SeriesMarker<Time>[] {
  return data.rsNewHighFrom
    ? [{ time: data.rsNewHighFrom as Time, position: "aboveBar", shape: "arrowUp", color: t.bull, text: "RS new high" }]
    : [];
}

export default function ChartCanvas({ data, height, showVolume, showRS, tokens, onCrosshairChange }: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // live refs so the theme/data effects can reach the chart objects
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsHiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bandRef = useRef<StageBandPrimitive | null>(null);
  const stageMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const rsMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const rsHighLineRef = useRef<IPriceLine | null>(null);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;

  // ---- build once per (symbol, showVolume, showRS, height) ------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const t = tokensRef.current;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: t.muted, fontFamily: "inherit", attributionLogo: false },
      grid: { vertLines: { color: t.border, style: LineStyle.Dotted }, horzLines: { color: t.border, style: LineStyle.Dotted } },
      rightPriceScale: { borderColor: t.border, scaleMargins: { top: 0.08, bottom: showVolume ? 0.24 : 0.08 } },
      timeScale: { borderColor: t.border, rightOffset: 4, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0, vertLine: { color: t.faint, labelBackgroundColor: t.surface2 }, horzLine: { color: t.faint, labelBackgroundColor: t.surface2 } },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });
    chartRef.current = chart;

    // Candles (pane 0)
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: t.bull, downColor: t.bear, borderVisible: false, wickUpColor: t.bull, wickDownColor: t.bear,
    });
    candle.setData(data.bars.map((b) => ({ time: b.date as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    candleRef.current = candle;

    // Stage bands (primitive on the candle series — no extra pane)
    const band = new StageBandPrimitive(data.stageSegments, t);
    candle.attachPrimitive(band);
    bandRef.current = band;

    // 150-day MA line (pane 0), gaps during warmup
    const ma = chart.addSeries(LineSeries, { color: t.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ma.setData(data.series.map((s) => (s.ma150 == null ? { time: s.date as Time } : { time: s.date as Time, value: s.ma150 })));
    maRef.current = ma;

    // Volume (pane 0, own overlay scale pinned to the bottom)
    if (showVolume) {
      const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      volume.setData(data.bars.map((b) => ({ time: b.date as Time, value: b.volume, color: b.close >= b.open ? t.bullSoft : t.bearSoft })));
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volumeRef.current = volume;
    }

    // Stage-transition markers on candles
    const stageMarkers = stageMarkersOf(data, t);
    if (stageMarkers.length) stageMarkersRef.current = createSeriesMarkers(candle, stageMarkers);

    // RS line (its own pane — a ratio's magnitude is meaningless against price)
    if (showRS && data.rs.length > 0) {
      const rs = chart.addSeries(LineSeries, { color: t.accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 1);
      rs.setData(data.rs.map((p) => ({ time: p.date as Time, value: p.rs })));
      rsRef.current = rs;
      // dashed reference at the 52-week RS high
      const lastHi = data.rs[data.rs.length - 1].rsHigh252;
      if (lastHi != null) rsHighLineRef.current = rs.createPriceLine({ price: lastHi, color: t.muted, lineStyle: LineStyle.Dashed, lineWidth: 1, title: "52w RS high" });
      // trailing new-high run recolored bull
      if (data.rsNewHighFrom) {
        const rsHi = chart.addSeries(LineSeries, { color: t.bull, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 1);
        rsHi.setData(data.rs.filter((p) => p.date >= (data.rsNewHighFrom as string)).map((p) => ({ time: p.date as Time, value: p.rs })));
        rsHiRef.current = rsHi;
        rsMarkersRef.current = createSeriesMarkers(rs, rsMarkersOf(data, t));
      }
      // give the RS pane ~25% of the height
      const panes = chart.panes();
      if (panes.length > 1) {
        panes[0].setStretchFactor(3);
        panes[1].setStretchFactor(1);
      }
    }

    chart.timeScale().fitContent();

    // ---- crosshair → interpretation-first payload ---------------------------
    const byDate = new Map(data.bars.map((b, i) => [b.date, i]));
    const rsByDate = new Map(data.rs.map((p) => [p.date, p]));
    const handler = (param: MouseEventParams) => {
      if (!onCrosshairChange) return;
      if (param.time == null) return onCrosshairChange(null);
      const date = timeToISO(param.time as Time);
      const i = byDate.get(date);
      if (i == null) return onCrosshairChange(null);
      const bar = data.bars[i];
      const ma150 = data.series[i]?.ma150 ?? null;
      const stage = data.stageBars[i]?.stage ?? null;
      const rp = rsByDate.get(date);
      const rel = pctVsMa(bar.close, ma150);
      onCrosshairChange({
        date, bar, ma150, pctVsMa: rel, stage,
        rs: rp?.rs ?? null, rsNewHigh: rp?.newHigh ?? false,
        sentence: buildCrosshairSentence(stage, rel, rp?.newHigh ?? false),
      });
    };
    chart.subscribeCrosshairMove(handler);

    // ---- resize -------------------------------------------------------------
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && chartRef.current) chartRef.current.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(handler);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      maRef.current = null;
      rsRef.current = null;
      rsHiRef.current = null;
      bandRef.current = null;
      stageMarkersRef.current = null;
      rsMarkersRef.current = null;
      rsHighLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, height, showVolume, showRS]);

  // ---- theme re-apply (no re-create) ---------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: tokens.muted },
      grid: { vertLines: { color: tokens.border }, horzLines: { color: tokens.border } },
      rightPriceScale: { borderColor: tokens.border },
      timeScale: { borderColor: tokens.border },
      crosshair: { vertLine: { color: tokens.faint, labelBackgroundColor: tokens.surface2 }, horzLine: { color: tokens.faint, labelBackgroundColor: tokens.surface2 } },
    });
    candleRef.current?.applyOptions({ upColor: tokens.bull, downColor: tokens.bear, wickUpColor: tokens.bull, wickDownColor: tokens.bear });
    maRef.current?.applyOptions({ color: tokens.accent });
    rsRef.current?.applyOptions({ color: tokens.accent });
    rsHiRef.current?.applyOptions({ color: tokens.bull });
    // per-point colors live in the data → re-set volume; bands repaint via primitive
    if (volumeRef.current) {
      volumeRef.current.setData(data.bars.map((b) => ({ time: b.date as Time, value: b.volume, color: b.close >= b.open ? tokens.bullSoft : tokens.bearSoft })));
    }
    bandRef.current?.setTokens(tokens);
    // markers + the RS-high price line carry build-time colors → recolor here too
    stageMarkersRef.current?.setMarkers(stageMarkersOf(data, tokens));
    rsMarkersRef.current?.setMarkers(rsMarkersOf(data, tokens));
    rsHighLineRef.current?.applyOptions({ color: tokens.muted });
  }, [tokens, data]);

  return <div ref={containerRef} className="w-full" style={{ height }} aria-hidden />;
}

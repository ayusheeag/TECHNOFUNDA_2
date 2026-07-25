// v5 series primitive: translucent full-height Weinstein-stage bands painted on
// the PRICE pane, behind the candles (zOrder 'bottom'). Attached to the candle
// series so it consumes NO extra pane. Uses logicalToCoordinate (which
// extrapolates past the visible range) so bands stay aligned on pan/zoom and
// segments that run off-screen still clamp to the pane edges.
//
// Centralizes all lib coupling with ChartCanvas — an upgrade touches only these
// two files. Type-only lib imports (erased at build), so this stays lightweight.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  Logical,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
} from "lightweight-charts";
import type { StageSegment } from "@/lib/dataProvider";
import { stageColor, type ChartThemeTokens } from "./chartTheme";

const BAND_ALPHA = 0.1;

function hexToRgba(color: string, alpha: number): string {
  if (!color.startsWith("#")) return color;
  const h = color.slice(1);
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

class StageBandRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _src: StageBandPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this._src.chart;
    if (!chart) return;
    const ts = chart.timeScale();
    const segs = this._src.segments;
    const tokens = this._src.tokens;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { horizontalPixelRatio: hpr } = scope;
      const height = scope.bitmapSize.height;
      const width = scope.bitmapSize.width;
      for (const seg of segs) {
        const c1 = ts.logicalToCoordinate((seg.startIndex - 0.5) as Logical);
        const c2 = ts.logicalToCoordinate((seg.endIndex + 0.5) as Logical);
        if (c1 == null || c2 == null) continue;
        let left = Math.min(c1, c2) * hpr;
        let right = Math.max(c1, c2) * hpr;
        // clamp to the pane so far-offscreen segments don't overflow
        left = Math.max(0, left);
        right = Math.min(width, right);
        if (right <= left) continue;
        ctx.fillStyle = hexToRgba(stageColor(seg.stage, tokens), BAND_ALPHA);
        ctx.fillRect(left, 0, right - left, height);
      }
    });
  }
}

class StageBandPaneView implements IPrimitivePaneView {
  private readonly _renderer: StageBandRenderer;
  constructor(src: StageBandPrimitive) {
    this._renderer = new StageBandRenderer(src);
  }
  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }
  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

export class StageBandPrimitive implements ISeriesPrimitive<Time> {
  chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  segments: StageSegment[];
  tokens: ChartThemeTokens;
  private _requestUpdate?: () => void;
  private readonly _views: StageBandPaneView[];

  constructor(segments: StageSegment[], tokens: ChartThemeTokens) {
    this.segments = segments;
    this.tokens = tokens;
    this._views = [new StageBandPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  }
  detached(): void {
    this.chart = null;
    this._requestUpdate = undefined;
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this._views;
  }
  updateAllViews(): void {
    /* renderers read live state from the primitive each draw */
  }

  setTokens(tokens: ChartThemeTokens): void {
    this.tokens = tokens;
    this._requestUpdate?.();
  }
  setSegments(segments: StageSegment[]): void {
    this.segments = segments;
    this._requestUpdate?.();
  }
}

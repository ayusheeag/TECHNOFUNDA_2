// Phase-2 chart payload. SUPERSET of the Python StageResponse (MIGRATION §3.4):
// same scalar fields + `series`, plus OHLCV / per-bar stage / RS arrays. The
// chart COMPUTES NOTHING — the provider delivers every series pre-computed.
import type { CompositeScore, Interpretation } from "@/lib/types";

/** "YYYY-MM-DD" (UTC calendar date). Assignable directly to lightweight-charts
 *  `Time` in its BusinessDay-string form; keeps the payload JSON-clean + SSR-safe. */
export type ISODate = string;
export type Stage = 1 | 2 | 3 | 4;

/** One daily bar. Mock guarantees low <= min(open,close) and high >= max(open,close). */
export interface OHLCVBar {
  date: ISODate;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** {date, close, ma150} — byte-compatible with StageResponse.series[]. ma150 is
 *  null for the first 149 bars (SMA warmup) so the line renders a gap. */
export interface StagePoint {
  date: ISODate;
  close: number;
  ma150: number | null;
}

/** Per-bar Weinstein classification + sub-signals, index-aligned 1:1 with `bars`.
 *  stage is null until bar index >= 169 (MA_WINDOW 150 + SLOPE_WINDOW 20 = 170 bars). */
export interface StageBar {
  date: ISODate;
  stage: Stage | null;
  aboveMa: boolean;
  maSlopePct: number | null; // (ma[i]-ma[i-20])/ma[i-20]*100
  rangePos: number | null; // 0 = trailing-252 low .. 100 = high
}

/** Maximal run of one stage (run-length-encoded from stageBars; null runs dropped).
 *  Drives the background bands AND the transition markers. */
export interface StageSegment {
  stage: Stage;
  startDate: ISODate;
  endDate: ISODate;
  startIndex: number;
  endIndex: number;
}

/** RS-line point. rs = close / benchmarkClose (date-aligned). rsHigh252 =
 *  rolling(252, minPeriods 5) max of rs. newHigh = rs >= rsHigh252 * (1 - 0.02). */
export interface RSPoint {
  date: ISODate;
  rs: number;
  rsHigh252: number | null;
  newHigh: boolean;
}

export type MarketPhase = "PREMARKET" | "RTH" | "POSTMARKET" | "CLOSED" | "WEEKEND" | "HOLIDAY";

export interface ChartMeta {
  source: "mock" | "api";
  generatedAt: string; // ISO timestamp — provenance for footer/disclaimer
  benchmarkSymbol: string; // "SPY"
  marketPhase: MarketPhase; // from the cache/market-hours stub
  stale: boolean;
  currency: "USD";
  firstDate: ISODate;
  lastDate: ISODate;
}

/** The Phase-2 chart payload for one symbol. */
export interface StockChartResponse {
  symbol: string;
  // --- StageResponse-compatible latest-bar scalars ---
  stage: Stage | null;
  label: string; // STAGE_LABEL[stage]
  action: string; // STAGE_ACTION[stage]
  close: number;
  ma150: number | null;
  aboveMa: boolean;
  maSlopePct: number | null;
  rangePos: number | null;
  rsi14: number | null; // Cutler/SMA RSI(14), latest bar only (matches Python)
  days: number;
  series: StagePoint[]; // {date,close,ma150} — kept for API parity
  interpretation: Interpretation; // plain-English header verdict (no naked numbers)
  ariaSummary: string; // sr-only description, built server-side from the RAW slope
  // --- Phase-2 chart extensions ---
  bars: OHLCVBar[];
  stageBars: StageBar[]; // index-aligned to bars
  stageSegments: StageSegment[];
  rs: RSPoint[]; // may be shorter than bars (needs benchmark overlap)
  rsNewHigh: boolean; // latest-bar convenience flag
  rsNewHighFrom: ISODate | null; // first bar of the CURRENT new-high run (marker anchor)
  meta: ChartMeta;
}

/** Emitted by the canvas on crosshair move → interpretation-first readout. */
export interface CrosshairPayload {
  date: ISODate;
  bar: OHLCVBar;
  ma150: number | null;
  pctVsMa: number | null; // (close/ma150 - 1) * 100
  stage: Stage | null;
  rs: number | null;
  rsNewHigh: boolean;
  sentence: string; // "Stage 2 uptrend · 6% above the 150-day · RS leading"
}

/** Provider options. Mock honours seed/regime/years; real ignores them. */
export interface GetStockChartOptions {
  benchmark?: string; // default "SPY"
  seed?: number; // deterministic mock (SSR stability); default = seedFromSymbol
  regime?: "full-cycle" | "up" | "down" | "choppy"; // mock scenario; default "full-cycle"
  years?: number; // default 4
  signal?: AbortSignal;
}

/** Latest-bar projection (mirrors GET /stocks/{sym}/stage). */
export type StageSnapshot = Pick<
  StockChartResponse,
  | "symbol"
  | "stage"
  | "label"
  | "action"
  | "close"
  | "ma150"
  | "aboveMa"
  | "maSlopePct"
  | "rangePos"
  | "rsi14"
  | "days"
  | "series"
  | "interpretation"
  | "rsNewHigh"
>;

// ============================================================================
// Phase-3 view models. camelCase wire shape; every list row ends in
// `interpretation: Interpretation` so "no naked numbers" is enforced at the
// CONTRACT, not in React. The mock IS the future API shape.
// ============================================================================
export type Verdict = "act" | "watch" | "avoid";
export type Sentiment = "pos" | "neutral" | "neg";
export type SoundChip = "sound" | "stretched" | "below-trend";
export type Regime = "aggressive" | "moderate" | "shallow";

export interface RegimeResponse {
  regime: Regime | null;
  pctAbove200ema: number | null; // >=60 aggressive, >=40 moderate (config parity)
  pctAbove50ema: number | null;
  new52wHighs: number;
  universeSize: number;
  icon: string; // REGIME[regime].glyph
  sizingText: string; // REGIME[regime].detail
  interpretation: Interpretation;
}
export interface MetaResponse {
  lastRunISO: string; // = MOCK_TODAY constant, NOT Date.now
  marketPhase: MarketPhase;
  universeSize: number;
  counts: { tickers: number; priceBars: number; fundamentals: number };
  regime: RegimeResponse;
  summary: Interpretation;
}
export interface BreadthRow {
  date: ISODate;
  pctAbove200ema: number;
  pctAbove50ema: number;
  new52wHighs: number;
  new52wLows: number;
  regime: Regime;
}
export interface BreadthHistory {
  rows: BreadthRow[];
  latest: BreadthRow;
  pctSpark: number[];
  nhSpark: number[];
  interpretation: Interpretation;
}
export interface SectorScore {
  sector: string;
  etf: string;
  close: number;
  rsi14: number | null;
  above200ema: boolean;
  above50ema: boolean;
  pctFrom52wHigh: number | null;
  monthsAboveTrend: number;
  soundNotStretched: boolean;
  chip: SoundChip;
  leaderSymbols: string[];
  interpretation: Interpretation;
}
export interface IndustryGrowthRow {
  industry: string;
  sector: string;
  medianRevYoY: number | null;
  breadthPctStage2: number;
  interpretation: Interpretation;
}
export interface ScreenRow {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  close: number;
  changePct: number;
  revenueYoY: number | null;
  epsYoY: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  roe: number | null;
  fcf: number | null;
  pe: number | null;
  evEbitda: number | null;
  rsi14: number | null;
  rsLine: number | null;
  rsNewHigh: boolean;
  at52wHigh: boolean;
  pctBelowHigh: number | null;
  stage: Stage | null;
  score: number; // revenueYoY - pctBelowHigh*0.5 + rsNewHigh*10 (Python parity)
  spark: number[]; // last ~40 closes of the SAME series the chart draws
  composite: CompositeScore; // row chip + detail card share this object
  interpretation: Interpretation;
}
/** Client-side, no round-trip. */
export interface ScreenFilters {
  stages?: Stage[];
  industries?: string[];
  sector?: string;
  rsNewHighOnly?: boolean;
  verdicts?: Verdict[];
  search?: string;
}
/** Bounded recompute (POST /screen). */
export interface ScreenParams {
  minGrowth?: number;
  maxDE?: number;
  minCurrentRatio?: number;
  industries?: string[];
}
export interface ReratingRow {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  peNow: number | null;
  peMedian: number | null;
  pePctile: number | null; // 0=cheap vs own history
  sectorPeMedian: number | null;
  peVsSector: number | null; // %, negative=discount
  revGrowthNow: number | null;
  revGrowthSlope: number | null; // >0 accelerating
  flagged: boolean;
  spark: number[];
  interpretation: Interpretation;
}
export interface TickerOption {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  label: string;
}
export interface StockDetailResponse {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  price: number;
  changePct: number;
  marketCap: number;
  stage: Stage | null;
  rsNewHigh: boolean;
  regime: Regime | null;
  composite: CompositeScore;
  interpretation: Interpretation; // header verdict sentence
}
export interface FinancialRow {
  period: string;
  reportDate: ISODate;
  revenue: number;
  revenueYoY: number | null;
  eps: number;
  epsYoY: number | null;
  grossMargin: number | null;
  fcf: number | null;
}
export interface FinancialsResponse {
  symbol: string;
  annual: FinancialRow[];
  quarterly: FinancialRow[];
  interpretation: Interpretation;
}
export interface ValuationHistoryRow {
  period: string;
  reportDate: ISODate;
  pe: number | null;
  evEbitda: number | null;
  revenueYoY: number | null;
}
export interface NewsItem {
  id: string;
  symbol: string;
  date: ISODate;
  title: string;
  source: string;
  url: string;
  sentiment: Sentiment;
  summary: string;
}
export interface TranscriptMeta {
  symbol: string;
  period: string;
  date: ISODate;
}
export interface ConcallSummary {
  symbol: string | null;
  period: string | null;
  date: ISODate | null;
  bullets: { theme: string; text: string; tone: Interpretation["tone"] }[];
  guidance: Interpretation;
  sentiment: Sentiment;
  source: "stored" | "generated";
  sourceNote: string;
}
export interface EarningsRow {
  symbol: string;
  name: string;
  date: ISODate;
  epsEstimate: number | null;
  time: "bmo" | "amc" | "unknown";
  daysUntil: number;
  stage: Stage | null;
  interpretation: Interpretation;
}
export interface WatchItem {
  symbol: string;
  name: string;
  stage: Stage | null;
  verdict: Verdict;
  nextEarnings: EarningsRow | null;
  changePct: number;
  close: number;
  spark: number[];
  interpretation: Interpretation;
}

/** The ONLY data surface components may call. Never fetch/axios in a component. */
export interface DataProvider {
  readonly mode: "mock" | "api";
  // Phase 2 (unchanged)
  getStockChart(symbol: string, opts?: GetStockChartOptions): Promise<StockChartResponse>;
  getStageSnapshot(symbol: string, opts?: GetStockChartOptions): Promise<StageSnapshot>;
  // Pulse
  getMeta(o?: { signal?: AbortSignal }): Promise<MetaResponse>;
  getRegime(o?: { signal?: AbortSignal }): Promise<RegimeResponse>;
  getBreadth(o?: { limit?: number; signal?: AbortSignal }): Promise<BreadthHistory>;
  getSectors(o?: { signal?: AbortSignal }): Promise<SectorScore[]>;
  getIndustryGrowth(o?: { signal?: AbortSignal }): Promise<IndustryGrowthRow[]>;
  // Screener / Ideas
  getScreenDefault(o?: { signal?: AbortSignal }): Promise<ScreenRow[]>;
  runScreen(params: ScreenParams, o?: { signal?: AbortSignal }): Promise<ScreenRow[]>;
  getRerating(o?: { onlyFlagged?: boolean; signal?: AbortSignal }): Promise<ReratingRow[]>;
  getSectorConstituents(sector: string, o?: { signal?: AbortSignal }): Promise<ScreenRow[]>;
  // Search + Stock Detail
  searchTickers(q: string, o?: { limit?: number; signal?: AbortSignal }): Promise<TickerOption[]>;
  getStockDetail(symbol: string, o?: { signal?: AbortSignal }): Promise<StockDetailResponse>;
  getFinancials(symbol: string, o?: { annualLimit?: number; quarterlyLimit?: number; signal?: AbortSignal }): Promise<FinancialsResponse>;
  getNews(symbol: string, o?: { limit?: number; signal?: AbortSignal }): Promise<NewsItem[]>;
  getValuationHistory(symbol: string, o?: { signal?: AbortSignal }): Promise<ValuationHistoryRow[]>;
  listTranscripts(o?: { symbol?: string; signal?: AbortSignal }): Promise<TranscriptMeta[]>;
  getConcall(symbol: string, period: string, o?: { signal?: AbortSignal }): Promise<ConcallSummary | null>;
  summarizeConcall(input: { text: string } | { symbol: string; period: string }, o?: { signal?: AbortSignal }): Promise<ConcallSummary>;
  // Earnings + Watchlist (localStorage-backed in mock)
  getEarnings(o?: { from?: ISODate; to?: ISODate; signal?: AbortSignal }): Promise<EarningsRow[]>;
  getWatchlist(o?: { signal?: AbortSignal }): Promise<WatchItem[]>;
  addToWatchlist(symbol: string): Promise<WatchItem>;
  removeFromWatchlist(symbol: string): Promise<void>;
  isWatched(symbol: string): boolean; // sync — instant star toggles
}

// ---- lightweight-charts adapter shapes (what ChartCanvas maps arrays into) ----
// Structural, NOT importing the lib type, so types.ts stays zero-runtime-dep and
// is safe to import from Server Components.
export interface LWCCandle {
  time: ISODate;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface LWCHistogram {
  time: ISODate;
  value: number;
  color?: string;
}
export interface LWCLine {
  time: ISODate;
  value: number;
}

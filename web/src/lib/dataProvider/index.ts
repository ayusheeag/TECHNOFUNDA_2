// The ONLY data surface components import. Default = mock, so the whole app
// runs with NO backend / NO keys. Flip to the real FastAPI provider with
// NEXT_PUBLIC_DATA_MODE=api + NEXT_PUBLIC_API_URL. Module-scoped singleton
// (not React context): importable from Server Components or the client, and
// tree-shakeable.
import { mockProvider } from "./mockProvider";
import { realProvider } from "./realProvider";
import type { DataProvider } from "./types";

const USE_MOCK = process.env.NEXT_PUBLIC_DATA_MODE !== "api" || !process.env.NEXT_PUBLIC_API_URL;

export const dataProvider: DataProvider = USE_MOCK ? mockProvider : realProvider;

/** Fired on the window when the (mock) watchlist changes — WatchStar/nav subscribe. */
export { WATCHLIST_CHANGED } from "./watchlistStore";
export { MOCK_TODAY } from "./constants";

export type {
  DataProvider,
  GetStockChartOptions,
  StockChartResponse,
  StageSnapshot,
  OHLCVBar,
  StagePoint,
  StageBar,
  StageSegment,
  RSPoint,
  CrosshairPayload,
  ChartMeta,
  MarketPhase,
  Timeframe,
  Stage,
  ISODate,
  // Phase 3 view models
  Verdict,
  Sentiment,
  SoundChip,
  Regime,
  MetaResponse,
  RegimeResponse,
  BreadthRow,
  BreadthHistory,
  SectorScore,
  IndustryGrowthRow,
  ScreenRow,
  ScreenFilters,
  ScreenParams,
  ReratingRow,
  LongShortRow,
  IndustryRerating,
  LongShortResponse,
  TickerOption,
  StockDetailResponse,
  FinancialRow,
  FinancialsResponse,
  ValuationHistoryRow,
  NewsItem,
  TranscriptMeta,
  ConcallSummary,
  EarningsRow,
  WatchItem,
} from "./types";

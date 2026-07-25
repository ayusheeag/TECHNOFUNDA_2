// Real DataProvider — GATED for the mock-only phases. Every method throws until
// NEXT_PUBLIC_API_URL is set; the intended FastAPI calls are documented so this
// path is drop-in once the backend lands. The mock IS the wire shape, so each
// real method is `fetch(<endpoint>) → normalize snake_case→camelCase → return`.
// Keep ALL casing translation in normalize() (one place) so the gated path
// can't rot. See MIGRATION.md §3.3 for the endpoint list.
import { cacheKey, marketPhase, withCache } from "./cache";
import type {
  BreadthHistory,
  ConcallSummary,
  DataProvider,
  EarningsRow,
  FinancialsResponse,
  GetStockChartOptions,
  IndustryGrowthRow,
  MetaResponse,
  NewsItem,
  RegimeResponse,
  ReratingRow,
  ScreenParams,
  ScreenRow,
  SectorScore,
  StageSnapshot,
  StockChartResponse,
  StockDetailResponse,
  TickerOption,
  TranscriptMeta,
  ValuationHistoryRow,
  WatchItem,
} from "./types";

export class ProviderNotConfiguredError extends Error {
  constructor() {
    super("Real data provider not enabled — set NEXT_PUBLIC_DATA_MODE=api and NEXT_PUBLIC_API_URL. The mock provider is the default.");
    this.name = "ProviderNotConfiguredError";
  }
}

const base = () => process.env.NEXT_PUBLIC_API_URL;

/** One place for GET + snake→camel normalization; each endpoint maps 1:1 into a view model. */
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const b = base();
  if (!b) throw new ProviderNotConfiguredError();
  const { value } = await withCache(cacheKey("api", path, null), marketPhase(), async () => {
    const res = await fetch(`${b.replace(/\/$/, "")}${path}`, { signal });
    if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
    return (await res.json()) as T; // FastAPI serializes camelCase-compatible models
  });
  return value;
}

const notReady = (): never => {
  throw new ProviderNotConfiguredError();
};

export const realProvider: DataProvider = {
  mode: "api",
  // Phase 2 — the one path with a written body (chart=1 asks for OHLCV+RS).
  async getStockChart(symbol: string, opts?: GetStockChartOptions): Promise<StockChartResponse> {
    return get<StockChartResponse>(`/stocks/${encodeURIComponent(symbol)}?chart=1`, opts?.signal);
  },
  async getStageSnapshot(symbol: string, opts?: GetStockChartOptions): Promise<StageSnapshot> {
    return get<StageSnapshot>(`/stocks/${encodeURIComponent(symbol)}/stage`, opts?.signal);
  },
  // Pulse — GET /meta, /regime, /breadth, /sectors, /sectors/industries
  getMeta: (o) => get<MetaResponse>("/meta", o?.signal),
  getRegime: (o) => get<RegimeResponse>("/regime", o?.signal),
  getBreadth: (o) => get<BreadthHistory>(`/breadth${o?.limit ? `?limit=${o.limit}` : ""}`, o?.signal),
  getSectors: (o) => get<SectorScore[]>("/sectors", o?.signal),
  getIndustryGrowth: (o) => get<IndustryGrowthRow[]>("/sectors/industries", o?.signal),
  // Screener — GET /screen/default, POST /screen, GET /rerating, /sectors/{s}/constituents
  getScreenDefault: (o) => get<ScreenRow[]>("/screen/default", o?.signal),
  runScreen: (_params: ScreenParams) => notReady(), // POST /screen (bounded)
  getRerating: (o) => get<ReratingRow[]>(`/rerating${o?.onlyFlagged ? "?only_flagged=1" : ""}`, o?.signal),
  getSectorConstituents: (sector, o) => get<ScreenRow[]>(`/sectors/${encodeURIComponent(sector)}/constituents`, o?.signal),
  // Search + Detail
  searchTickers: (q, o) => get<TickerOption[]>(`/tickers?q=${encodeURIComponent(q)}${o?.limit ? `&limit=${o.limit}` : ""}`, o?.signal),
  getStockDetail: (symbol, o) => get<StockDetailResponse>(`/stocks/${encodeURIComponent(symbol)}`, o?.signal),
  getFinancials: (symbol, o) => get<FinancialsResponse>(`/stocks/${encodeURIComponent(symbol)}/financials`, o?.signal),
  getNews: (symbol, o) => get<NewsItem[]>(`/stocks/${encodeURIComponent(symbol)}/news?limit=${o?.limit ?? 10}`, o?.signal),
  getValuationHistory: (symbol, o) => get<ValuationHistoryRow[]>(`/stocks/${encodeURIComponent(symbol)}/valuation-history`, o?.signal),
  listTranscripts: (o) => get<TranscriptMeta[]>(`/concall/transcripts${o?.symbol ? `?symbol=${encodeURIComponent(o.symbol)}` : ""}`, o?.signal),
  getConcall: (symbol, period, o) => get<ConcallSummary | null>(`/concall/${encodeURIComponent(symbol)}/${encodeURIComponent(period)}`, o?.signal),
  summarizeConcall: (_input) => notReady(), // POST /concall/summarize
  // Earnings + Watchlist (server-scoped once auth lands)
  getEarnings: (o) => get<EarningsRow[]>(`/earnings${o?.from ? `?from=${o.from}&to=${o.to ?? ""}` : ""}`, o?.signal),
  getWatchlist: (o) => get<WatchItem[]>("/watchlist", o?.signal),
  addToWatchlist: (_symbol) => notReady(), // POST /watchlist
  removeFromWatchlist: (_symbol) => notReady(), // DELETE /watchlist/{symbol}
  isWatched: (_symbol) => false, // server-scoped; UI hydrates from getWatchlist in the api path
};

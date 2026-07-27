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
  LongShortResponse,
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

/** Stable anonymous user id (client-side) so the server watchlist is per-user.
 *  Becomes the authenticated user id once real auth lands. */
function userId(): string {
  if (typeof window === "undefined") return "anon";
  try {
    let id = localStorage.getItem("tf-uid");
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `u-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      localStorage.setItem("tf-uid", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/** One place for GET + snake→camel normalization; each endpoint maps 1:1 into a view model. */
async function get<T>(path: string, signal?: AbortSignal, cache = true): Promise<T> {
  const b = base();
  if (!b) throw new ProviderNotConfiguredError();
  const doFetch = async () => {
    // no-store → RSC routes stay dynamic (always fresh, and the Vercel build
    // doesn't need the API up to prerender). The in-process withCache below
    // still throttles load per market phase.
    const res = await fetch(`${b.replace(/\/$/, "")}${path}`, { signal, headers: { "X-User-Id": userId() }, cache: "no-store" });
    if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
    return (await res.json()) as T;
  };
  if (!cache) return doFetch();
  const { value } = await withCache(cacheKey("api", path, null), marketPhase(), doFetch);
  return value;
}

async function send<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const b = base();
  if (!b) throw new ProviderNotConfiguredError();
  const res = await fetch(`${b.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "content-type": "application/json", "X-User-Id": userId() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}
const post = <T>(path: string, body: unknown, signal?: AbortSignal) => send<T>("POST", path, body, signal);

export const realProvider: DataProvider = {
  mode: "api",
  // Phase 2 — the one path with a written body (chart=1 asks for OHLCV+RS).
  async getStockChart(symbol: string, opts?: GetStockChartOptions): Promise<StockChartResponse> {
    const tf = opts?.timeframe ? `&tf=${opts.timeframe}` : "";
    return get<StockChartResponse>(`/stocks/${encodeURIComponent(symbol)}?chart=1${tf}`, opts?.signal);
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
  runScreen: (params: ScreenParams, o) => post<ScreenRow[]>("/screen", params, o?.signal),
  getRerating: (o) => get<ReratingRow[]>(`/rerating${o?.onlyFlagged ? "?only_flagged=1" : ""}`, o?.signal),
  getLongShort: (o) => get<LongShortResponse>(`/rerating/long-short?window=${o?.window ?? 3}&top=${o?.top ?? 25}`, o?.signal),
  getSectorConstituents: (sector, o) => get<ScreenRow[]>(`/sectors/${encodeURIComponent(sector)}/constituents`, o?.signal),
  // Search + Detail
  searchTickers: (q, o) => get<TickerOption[]>(`/tickers?q=${encodeURIComponent(q)}${o?.limit ? `&limit=${o.limit}` : ""}`, o?.signal),
  getStockDetail: (symbol, o) => get<StockDetailResponse>(`/stocks/${encodeURIComponent(symbol)}`, o?.signal),
  getFinancials: (symbol, o) => get<FinancialsResponse>(`/stocks/${encodeURIComponent(symbol)}/financials`, o?.signal),
  getNews: (symbol, o) => get<NewsItem[]>(`/stocks/${encodeURIComponent(symbol)}/news?limit=${o?.limit ?? 10}`, o?.signal),
  getValuationHistory: (symbol, o) => get<ValuationHistoryRow[]>(`/stocks/${encodeURIComponent(symbol)}/valuation-history`, o?.signal),
  listTranscripts: (o) => get<TranscriptMeta[]>(`/concall/transcripts${o?.symbol ? `?symbol=${encodeURIComponent(o.symbol)}` : ""}`, o?.signal),
  getConcall: (symbol, period, o) => get<ConcallSummary | null>(`/concall/${encodeURIComponent(symbol)}/${encodeURIComponent(period)}`, o?.signal),
  summarizeConcall: (input, o) => post<ConcallSummary>("/concall/summarize", input, o?.signal),
  // Earnings + Watchlist (per-user via the X-User-Id header)
  getEarnings: (o) => get<EarningsRow[]>(`/earnings${o?.from ? `?from=${o.from}&to=${o.to ?? ""}` : ""}`, o?.signal),
  getWatchlist: (o) => get<WatchItem[]>("/watchlist", o?.signal, false), // per-user → never share-cache
  addToWatchlist: (symbol) => post<WatchItem>("/watchlist", { symbol }),
  removeFromWatchlist: (symbol) => send<void>("DELETE", `/watchlist/${encodeURIComponent(symbol)}`),
  isWatched: (_symbol) => false, // async server list; the WatchStar/useWatchlist hydrate it
};

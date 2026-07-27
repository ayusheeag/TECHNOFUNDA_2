// Mock DataProvider — the assembly hub. Composes the deterministic mock modules
// into the full provider surface. Every derived surface reads the SAME memoized
// chartFor(symbol), so a symbol's screener row, composite, watchlist card and
// detail chart are byte-identical. Isomorphic + deterministic (RSC or browser).
import { marketPhase } from "./cache";
import { buildComposite } from "./composite";
import { MOCK_TODAY } from "./constants";
import { build, changePctOf, chartFor, projectSnapshot, sparkOf } from "./mockChart";
import { earningsFor, getConcall, getEarnings, getNews, listTranscripts, summarizeConcall } from "./mockContent";
import { fundamentalsFor } from "./mockFundamentals";
import { mockLongShort } from "./mockLongShort";
import { getBreadthHistory, getIndustryGrowth, getRegime, getSectors, sectorPeMedian } from "./mockMarket";
import { getRerating, getScreenDefault, getSectorConstituents, runScreen } from "./mockScreener";
import { UNIVERSE, lookup, searchUniverse } from "./universe";
import { addSymbol, isWatched, listSymbols, removeSymbol } from "./watchlistStore";
import type { Interpretation } from "@/lib/types";
import type {
  DataProvider,
  FinancialsResponse,
  GetStockChartOptions,
  MetaResponse,
  StockDetailResponse,
  ValuationHistoryRow,
  WatchItem,
} from "./types";

/** Detail header — light: chart + fundamentals + composite. */
function detailOf(symbol: string): StockDetailResponse {
  const u = lookup(symbol);
  if (!u) throw new Error(`Unknown symbol: ${symbol}`); // mock covers only its universe
  const chart = chartFor(symbol);
  const fund = fundamentalsFor(symbol);
  const composite = buildComposite({ chart, fund, sectorPeMedian: sectorPeMedian(u?.sector ?? "") });
  return {
    symbol: chart.symbol,
    name: u?.name ?? chart.symbol,
    sector: u?.sector ?? "—",
    industry: u?.industry ?? "—",
    price: chart.close,
    changePct: changePctOf(chart),
    marketCap: fund.marketCap,
    stage: chart.stage,
    rsNewHigh: chart.rsNewHigh,
    regime: getRegime().regime,
    composite,
    interpretation: composite.interpretation,
  };
}

function financialsOf(symbol: string): FinancialsResponse {
  const fund = fundamentalsFor(symbol);
  const rev = fund.latest.revenueYoY;
  const eps = fund.latest.epsYoY;
  const revTxt = rev == null ? "n/a" : `${rev >= 0 ? "+" : "−"}${Math.abs(rev).toFixed(0)}%`;
  const epsTxt = eps == null ? "n/a" : `${eps >= 0 ? "+" : "−"}${Math.abs(eps).toFixed(0)}%`;
  const interpretation: Interpretation = {
    headline: `Revenue ${revTxt} YoY, EPS ${epsTxt} (latest reported year)`,
    tone: (rev ?? 0) >= 15 ? "good" : (rev ?? 0) < 0 ? "bad" : "neutral",
    detail: "EPS growth is based on continuing operations (split-immune); n/a when the prior base was zero or negative.",
  };
  return { symbol: symbol.toUpperCase(), annual: fund.annual, quarterly: fund.quarterly, interpretation };
}

function valuationHistoryOf(symbol: string): ValuationHistoryRow[] {
  const fund = fundamentalsFor(symbol);
  return fund.quarterly.map((q, i) => ({
    period: q.period,
    reportDate: q.reportDate,
    pe: fund.peSeries[i] ?? null,
    evEbitda: fund.peSeries[i] == null ? null : Math.round(fund.peSeries[i] * 0.6 * 10) / 10,
    revenueYoY: q.revenueYoY,
  }));
}

function watchItemOf(symbol: string): WatchItem {
  const d = detailOf(symbol);
  const chart = chartFor(symbol);
  const earn = earningsFor(symbol);
  const soon = earn.daysUntil <= 7;
  const interpretation: Interpretation = {
    headline: `${d.composite.verdict === "act" ? "Setup lines up" : d.composite.verdict === "avoid" ? "Weak — consider dropping" : "Mixed — keep watching"}`,
    tone: d.composite.verdict === "act" ? "good" : d.composite.verdict === "avoid" ? "bad" : "warn",
    detail: soon ? `Reports in ${earn.daysUntil} day${earn.daysUntil === 1 ? "" : "s"} — the near-term catalyst.` : `Next earnings ${earn.daysUntil} days out.`,
  };
  return {
    symbol: d.symbol,
    name: d.name,
    stage: d.stage,
    verdict: d.composite.verdict as WatchItem["verdict"],
    nextEarnings: earn,
    changePct: d.changePct,
    close: d.price,
    spark: sparkOf(chart),
    interpretation,
  };
}

function metaOf(): MetaResponse {
  const regime = getRegime();
  const summary: Interpretation = {
    headline: regime.interpretation.headline,
    tone: regime.interpretation.tone,
    detail: `${UNIVERSE.length} names tracked · data as of ${MOCK_TODAY}.`,
  };
  return {
    lastRunISO: MOCK_TODAY,
    marketPhase: marketPhase(),
    universeSize: UNIVERSE.length,
    counts: { tickers: UNIVERSE.length, priceBars: UNIVERSE.length * 1000, fundamentals: UNIVERSE.length },
    regime,
    summary,
  };
}

export const mockProvider: DataProvider = {
  mode: "mock",
  // ---- Phase 2 --------------------------------------------------------------
  async getStockChart(symbol, opts?: GetStockChartOptions) {
    return opts && (opts.regime || opts.seed != null || opts.years != null) ? build(symbol, opts) : chartFor(symbol);
  },
  async getStageSnapshot(symbol, opts?: GetStockChartOptions) {
    return projectSnapshot(opts && (opts.regime || opts.seed != null) ? build(symbol, opts) : chartFor(symbol));
  },
  // ---- Pulse ----------------------------------------------------------------
  async getMeta() {
    return metaOf();
  },
  async getRegime() {
    return getRegime();
  },
  async getBreadth(o) {
    const b = getBreadthHistory();
    if (o?.limit && o.limit < b.rows.length) {
      const rows = b.rows.slice(-o.limit);
      return { ...b, rows, pctSpark: rows.map((r) => r.pctAbove200ema), nhSpark: rows.map((r) => r.new52wHighs) };
    }
    return b;
  },
  async getSectors() {
    return getSectors();
  },
  async getIndustryGrowth() {
    return getIndustryGrowth();
  },
  // ---- Screener / Ideas -----------------------------------------------------
  async getScreenDefault() {
    return getScreenDefault();
  },
  async runScreen(params) {
    return runScreen(params);
  },
  async getRerating(o) {
    return getRerating(o?.onlyFlagged ?? false);
  },
  async getLongShort(o) {
    return mockLongShort(o?.top ?? 25);
  },
  async getSectorConstituents(sector) {
    return getSectorConstituents(sector);
  },
  // ---- Search + Stock Detail ------------------------------------------------
  async searchTickers(q, o) {
    return searchUniverse(q, o?.limit ?? 8).map((u) => ({
      symbol: u.symbol,
      name: u.name,
      sector: u.sector,
      marketCap: fundamentalsFor(u.symbol).marketCap,
      label: `${u.symbol} · ${u.name}`,
    }));
  },
  async getStockDetail(symbol) {
    return detailOf(symbol);
  },
  async getFinancials(symbol) {
    return financialsOf(symbol);
  },
  async getNews(symbol, o) {
    return getNews(symbol, o?.limit ?? 10);
  },
  async getValuationHistory(symbol) {
    return valuationHistoryOf(symbol);
  },
  async listTranscripts(o) {
    return listTranscripts(o?.symbol);
  },
  async getConcall(symbol, period) {
    return getConcall(symbol, period);
  },
  async summarizeConcall(input) {
    return summarizeConcall(input);
  },
  // ---- Earnings + Watchlist -------------------------------------------------
  async getEarnings(o) {
    return getEarnings(o?.from, o?.to);
  },
  async getWatchlist() {
    return listSymbols()
      .filter((s) => lookup(s))
      .map((s) => watchItemOf(s));
  },
  async addToWatchlist(symbol) {
    addSymbol(symbol);
    return watchItemOf(symbol);
  },
  async removeFromWatchlist(symbol) {
    removeSymbol(symbol);
  },
  isWatched(symbol) {
    return isWatched(symbol);
  },
};

// The fixed mock universe. A single source of truth for symbol → name / sector
// / industry so search, screener, sectors, and watchlist all agree. Real,
// recognizable tickers so the app feels alive; all data derived from them is
// deterministic (seedFromSymbol). NOT investment guidance — a demo universe.

export interface Sector {
  key: string; // GICS-ish sector name
  etf: string; // sector-ETF proxy for the RSI leaderboard
}

export const SECTORS: Sector[] = [
  { key: "Technology", etf: "XLK" },
  { key: "Health Care", etf: "XLV" },
  { key: "Financials", etf: "XLF" },
  { key: "Consumer Discretionary", etf: "XLY" },
  { key: "Communication Services", etf: "XLC" },
  { key: "Industrials", etf: "XLI" },
  { key: "Energy", etf: "XLE" },
  { key: "Consumer Staples", etf: "XLP" },
  { key: "Utilities", etf: "XLU" },
  { key: "Materials", etf: "XLB" },
  { key: "Real Estate", etf: "XLRE" },
];

export interface UniverseEntry {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
}

export const UNIVERSE: UniverseEntry[] = [
  // Technology
  { symbol: "NVDA", name: "NVIDIA Corp", sector: "Technology", industry: "Semiconductors" },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Technology", industry: "Semiconductors" },
  { symbol: "MU", name: "Micron Technology", sector: "Technology", industry: "Semiconductors" },
  { symbol: "AVGO", name: "Broadcom Inc.", sector: "Technology", industry: "Semiconductors" },
  { symbol: "SMCI", name: "Super Micro Computer", sector: "Technology", industry: "Computer Hardware" },
  { symbol: "CRM", name: "Salesforce, Inc.", sector: "Technology", industry: "Application Software" },
  { symbol: "ADBE", name: "Adobe Inc.", sector: "Technology", industry: "Application Software" },
  { symbol: "PLTR", name: "Palantir Technologies", sector: "Technology", industry: "Application Software" },
  // Health Care
  { symbol: "LLY", name: "Eli Lilly & Co", sector: "Health Care", industry: "Pharmaceuticals" },
  { symbol: "VRTX", name: "Vertex Pharmaceuticals", sector: "Health Care", industry: "Biotechnology" },
  { symbol: "MDGL", name: "Madrigal Pharmaceuticals", sector: "Health Care", industry: "Biotechnology" },
  { symbol: "ISRG", name: "Intuitive Surgical", sector: "Health Care", industry: "Medical Devices" },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Health Care", industry: "Healthcare Plans" },
  { symbol: "REGN", name: "Regeneron Pharmaceuticals", sector: "Health Care", industry: "Biotechnology" },
  // Financials
  { symbol: "JPM", name: "JPMorgan Chase & Co.", sector: "Financials", industry: "Diversified Banks" },
  { symbol: "GS", name: "Goldman Sachs Group", sector: "Financials", industry: "Investment Banking" },
  { symbol: "V", name: "Visa Inc.", sector: "Financials", industry: "Payments" },
  { symbol: "MA", name: "Mastercard Inc.", sector: "Financials", industry: "Payments" },
  { symbol: "COIN", name: "Coinbase Global", sector: "Financials", industry: "Capital Markets" },
  // Consumer Discretionary
  { symbol: "AMZN", name: "Amazon.com, Inc.", sector: "Consumer Discretionary", industry: "Internet Retail" },
  { symbol: "TSLA", name: "Tesla, Inc.", sector: "Consumer Discretionary", industry: "Automobiles" },
  { symbol: "CMG", name: "Chipotle Mexican Grill", sector: "Consumer Discretionary", industry: "Restaurants" },
  { symbol: "DKNG", name: "DraftKings Inc.", sector: "Consumer Discretionary", industry: "Gaming" },
  { symbol: "NKE", name: "NIKE, Inc.", sector: "Consumer Discretionary", industry: "Apparel" },
  // Communication Services
  { symbol: "META", name: "Meta Platforms, Inc.", sector: "Communication Services", industry: "Interactive Media" },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Communication Services", industry: "Interactive Media" },
  { symbol: "NFLX", name: "Netflix, Inc.", sector: "Communication Services", industry: "Entertainment" },
  { symbol: "DIS", name: "The Walt Disney Company", sector: "Communication Services", industry: "Entertainment" },
  // Industrials
  { symbol: "CAT", name: "Caterpillar Inc.", sector: "Industrials", industry: "Construction Machinery" },
  { symbol: "DE", name: "Deere & Company", sector: "Industrials", industry: "Farm Machinery" },
  { symbol: "GE", name: "GE Aerospace", sector: "Industrials", industry: "Aerospace & Defense" },
  { symbol: "UBER", name: "Uber Technologies", sector: "Industrials", industry: "Ground Transportation" },
  // Energy
  { symbol: "XOM", name: "Exxon Mobil Corp", sector: "Energy", industry: "Integrated Oil & Gas" },
  { symbol: "CVX", name: "Chevron Corp", sector: "Energy", industry: "Integrated Oil & Gas" },
  { symbol: "FSLR", name: "First Solar, Inc.", sector: "Energy", industry: "Solar" },
  // Consumer Staples
  { symbol: "COST", name: "Costco Wholesale", sector: "Consumer Staples", industry: "Consumer Staples Retail" },
  { symbol: "WMT", name: "Walmart Inc.", sector: "Consumer Staples", industry: "Consumer Staples Retail" },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer Staples", industry: "Household Products" },
  // Utilities
  { symbol: "NEE", name: "NextEra Energy", sector: "Utilities", industry: "Electric Utilities" },
  { symbol: "VST", name: "Vistra Corp.", sector: "Utilities", industry: "Independent Power" },
  // Materials
  { symbol: "LIN", name: "Linde plc", sector: "Materials", industry: "Industrial Gases" },
  { symbol: "FCX", name: "Freeport-McMoRan", sector: "Materials", industry: "Copper" },
  // Real Estate
  { symbol: "PLD", name: "Prologis, Inc.", sector: "Real Estate", industry: "Industrial REITs" },
  { symbol: "AMT", name: "American Tower Corp", sector: "Real Estate", industry: "Telecom REITs" },
];

const BY_SYMBOL = new Map(UNIVERSE.map((u) => [u.symbol, u]));

export function lookup(symbol: string): UniverseEntry | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

/** Fuzzy search by symbol prefix (ranked first) then name substring. */
export function searchUniverse(query: string, limit = 8): UniverseEntry[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const symPrefix: UniverseEntry[] = [];
  const symContains: UniverseEntry[] = [];
  const nameMatch: UniverseEntry[] = [];
  for (const u of UNIVERSE) {
    if (u.symbol === q) return [u, ...UNIVERSE.filter((x) => x.symbol.startsWith(q) && x.symbol !== q)].slice(0, limit);
    if (u.symbol.startsWith(q)) symPrefix.push(u);
    else if (u.symbol.includes(q)) symContains.push(u);
    else if (u.name.toUpperCase().includes(q)) nameMatch.push(u);
  }
  return [...symPrefix, ...symContains, ...nameMatch].slice(0, limit);
}

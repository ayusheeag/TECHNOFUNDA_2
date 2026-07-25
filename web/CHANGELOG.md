# Web app changelog

The Next.js frontend for TechnoFunda. See `../MIGRATION.md` for the full plan.

## Phase 3 — Product screens (2026-07)

The five-tab product (MIGRATION §4), wired to an extended mock `dataProvider` —
no backend, no keys. First principle enforced: each screen answers its funnel
question above the fold, and no metric appears without a plain-English read.

### The consistency invariant
A memoized `chartFor(symbol)` is the single source of price/technical truth, so a
symbol's **screener row, composite score, watchlist card and detail chart are
byte-identical** — the technical sub-score is provably a projection of the chart
the detail page draws (verified in the browser: NVDA reads "Stage 1" in the
header badge, the composite Technical leg, and the chart's own aria-summary).

### Added — data layer (`src/lib/dataProvider/`)
- **`universe.ts`** — 45 real tickers across 11 sectors (+ ETFs) with `searchUniverse()`.
- **`mockChart.ts`** — `scenarioForSymbol` + memoized `chartFor`; `build()`'s default
  scenario is now per-symbol so chart↔composite agree.
- **`mockFundamentals.ts`** — deterministic 5y annual + 12q quarterly + P/E history
  from a second seed stream; growth regime biased by the price scenario; split-immune YoY.
- **`composite.ts`** (+golden test) — the strengthened TechnoFunda score: technical
  (from the chart) + growth (SOLID) + ownership + valuation (provisional, full weight);
  Stage-2-gated `act`/`watch`/`avoid` verdict; a Stage-4 name can never read "act".
- **`mockMarket.ts`** — EMA200 breadth/regime (thresholds 60/40), sector-ETF RSI
  leaderboard (sound/stretched), industry growth.
- **`mockScreener.ts`** (+parity test) — screener score (`revYoY − pctBelowHigh×0.5 +
  rsNewHigh×10`) and rerating-flag mirror the Python formulas.
- **`mockContent.ts`** — earnings/news/concall anchored to a `MOCK_TODAY` constant
  (deterministic `daysUntil`, no `Date.now`). **`watchlistStore.ts`** — SSR-safe
  localStorage symbol list. Provider widened to ~25 methods; `realProvider` gated
  stubs with one-place snake→camel mapping. **23 tests pass.**

### Added — design system + shell
- Badges/spine: **VerdictChip** (act/watch/avoid, word+glyph), **StageBadge**,
  **SectorChip**, **RegimeBadge** (hero + compact). **CompositeScoreCard**,
  **SectorLeaderboard**, **BreadthSparkCard**, **FinancialsTable**, **NewsCard**,
  **ConcallDigest**, **EarningsCalendar** (native date pickers), **WatchlistCard**,
  **WatchStar**, **ScreenerTable**/**ScreenerFilters**, and a dependency-free
  **VirtualList** (aria-rowcount + true aria-rowindex, keyboard).
- Shell: `(app)` route group with `banner`/`nav`/`main`/`footer` landmarks, a
  responsive **PrimaryNav** (mobile bottom bar / desktop rail), **SkipLink**, and a
  WAI-ARIA combobox **StockSearch**. `/dev/*` galleries stay outside the group.

### Added — screens
- **Pulse `/`** — regime posture + breadth sparklines + sector leaderboard + top industries.
- **Screener `/screener`** — ranked ideas with client-side filters, a Re-rating view,
  and a bounded "Advanced" recompute; verdict spine on every row.
- **Stock Detail `/stocks/[symbol]`** — header + CompositeScoreCard + the (lazy) chart
  + Annual/Quarterly financials + concall digest (summarize-on-demand) + news + WatchStar.
- **Watchlist `/watchlist`** — localStorage-backed cards sorted by earnings/verdict, with undo.
- **More `/more`** — earnings calendar, concall tool, industry growth, sector deep-dive.

### Verified
- Build clean; **every route < 200 KB First Load JS** (Stock Detail with the chart =
  124 KB — the 164 KB chart lib stays a lazy chunk, off every route's number).
- Pulse / Screener / Stock Detail / Watchlist all render; no console errors; the
  chart↔composite invariant holds on-screen.

## Phase 2 — Charts & dataProvider (2026-07)

TradingView `lightweight-charts` price chart with Weinstein-stage bands and a
relative-strength line, wired through a single server-side `dataProvider` that
runs entirely on mock data — no backend, no API keys.

### Added — data layer (`src/lib/dataProvider/`)
- **`analysis.ts` — the parity core.** Pure TS port of the live Python analysis,
  constant-for-constant: `classify_stage` (the SCALAR ladder), the 150-day SMA +
  20-day slope + 252-day range-position stage math, Cutler/SMA `rsi14`, the RS
  line (`close/benchmark`, rolling-252 new-high at 2% tolerance), and RLE stage
  segments. Flags the upstream `stage_snapshot` vs `classify_stage` inconsistency.
- **Golden parity test.** `scripts/gen_chart_parity_fixture.py` runs the REAL
  `stage.py`/`screener.py` on a deterministic multi-stage series; `analysis.test.ts`
  (vitest) asserts the TS port matches bar-for-bar (per-bar stage across 1000 bars,
  latest scalars, RSI, RS + new-high flag). 8 tests pass.
- **`mockSeries.ts`** — deterministic, seedable OHLCV + steady-benchmark generator
  that traverses all four Weinstein stages (SSR-stable: pure LCG, fixed date anchor,
  no `Date.now`/`Math.random`). **`mockProvider.ts`** assembles the wire shape;
  **`realProvider.ts`** is the gated FastAPI path (throws until `NEXT_PUBLIC_API_URL`);
  **`cache.ts`** the market-hours/TTL stub; **`index.ts`** the mock-default singleton.
- **`types.ts`** — `StockChartResponse` (a superset of the Python `StageResponse`),
  zero runtime deps so Server Components can import it. **`interpret.ts`** — the
  plain-English sentence builders (header, crosshair, RS leadership, aria summary).

### Added — chart (`src/design-system/StockChart/`)
- **`StockChart`** — top-level wrapper: a11y `<figure>`, loading/empty/error/ready
  state machine, lazy-loads the canvas only when data is ready.
- **`ChartCanvas`** (dynamic `ssr:false`, the ONLY lib consumer) — candles + volume
  in the price pane, 150-day MA overlay (gapped during warmup), RS line in its own
  pane with a dashed 52-week-high reference + trailing new-high recolor + marker,
  stage-transition markers, resize, theme-apply, leak-free teardown.
- **`StageBandPrimitive`** — v5 `ISeriesPrimitive` painting translucent full-height
  stage bands behind the candles (no extra pane), via `logicalToCoordinate`.
- **`useChartTheme`/`chartTheme`** — reads the CSS-variable palette and re-emits on
  `data-theme` flips (MutationObserver + matchMedia) so the canvas recolors in place.
- **`ChartHeader`, `RSNewHighBadge`, `StageRibbonLegend`, `CrosshairReadout`,
  `ChartDataTable`, `ChartAriaSummary`, `ChartSkeleton`** — the interpretation +
  a11y layer (sr-only summary, semantic table with text-not-color cues, aria-live
  crosshair, colorblind-safe legend).

### Added — demo & tooling
- **`/dev/chart`** route (Server Component computes the payload) + a Route Handler
  (`/api/dev/chart`) so symbol/regime switching ships zero generator code to the
  client. Vitest test script (`npm test`).

### Verified
- Build clean; `/dev/chart` First Load JS = **97.7 kB** (< 200 KB budget). The
  ~164 KB lightweight-charts chunk is lazy — not referenced in the initial HTML.
- Renders in dark + light, mobile + desktop; theme flips recolor the canvas in
  place (no rebuild); regime switching works via the server round-trip; no console
  errors. Parity + provider tests green.

### Next (Phase 3)
Wire the real screens (Pulse / Screener / Stock Detail / Watchlist) onto the
dataProvider, and generate the API types from `/openapi.json` when the FastAPI
backend lands.

## Phase 1 — Design system (2026-07)

First runnable frontend. No backend yet — everything runs on deterministic mock data.

### Added
- **Scaffold:** Next.js 14 (App Router) + TypeScript + Tailwind 3.4. `@/*` path alias,
  `NEXT_PUBLIC_API_URL` env hook, mobile-first (375px baseline).
- **Theming:** CSS-variable design tokens (`globals.css`) with dark default + light theme, swapped
  via `[data-theme]`. No-flash inline script in `layout.tsx`; `ThemeToggle` persists to
  localStorage. `prefers-color-scheme` + `prefers-reduced-motion` respected.
- **Tokens** (`design-system/tokens.ts`): `direction()` (arrow + sign, never color-only), `STAGE`
  (Weinstein 1–4), `REGIME` (breadth → position-sizing guidance), `TONE_CLASS`. Tailwind config maps
  every color to a CSS variable; `.tnum` tabular-nums; 44px touch tokens; elevation/shadow scale;
  shimmer / sheet-up / flash keyframes.
- **Components** (`design-system/`): `Sparkline`, `TrendBadge`, `MetricPill` (value + **required**
  interpretation — no naked numbers), `ScoreRing` (composite score gauge), `SegmentedControl`,
  `StockRow`, `StockCard`, `BottomSheet` (mobile modal replacement), `MarketStatusBadge` (ET session
  phase), `SkeletonLoader`, `EmptyState`, `Disclaimer`. Barrel export at `design-system/index.ts`.
- **Lib:** `format.ts` (mirrors `humanize_usd`), `types.ts` (mirrors planned API models),
  `mock.ts` (deterministic up/down/choppy regimes — UI runs with no keys / no backend).
- **Demo route** `/dev/components`: live gallery of every component across all three mock regimes
  and both themes, with a regime switcher.
- **Docs:** `design-system/README.md` (principles, token table, component prop reference).

### Principles enforced in code
No naked numbers · direction never color-only · provisional data visibly flagged · skeletons on
every async surface · ≥44px touch targets · research-not-advice disclaimer.

### Next (Phase 2)
TradingView `lightweight-charts` price/volume chart with stage & RS-line overlays, behind the same
`dataProvider` mock path.

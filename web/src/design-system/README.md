# TechnoFunda Design System

The shared component library for the web app. Import everything from the barrel:

```ts
import { StockRow, MetricPill, ScoreRing, TrendBadge } from "@/design-system";
```

**Live gallery:** run the app and open [`/dev/components`](../app/dev/components/page.tsx) — every
component is shown in the `up` / `down` / `choppy` mock regimes and in both themes (toggle top-right).

## First principles (enforced by the components)

1. **No naked numbers.** Any metric surfaced to the user carries a one-line plain-English
   interpretation. `MetricPill` *requires* an `interpretation` prop — you cannot render a value
   without its meaning.
2. **Direction never relies on color alone.** `TrendBadge` and the `direction()` token always pair
   the bull/bear color with an arrow (▲ ▼ ▬) and an explicit `+ / −` sign, so meaning survives
   color-blindness and grayscale.
3. **Provisional data is visibly provisional.** Thin inputs (ownership, valuation on the free tier)
   render with a dashed border + a `provisional` chip (`MetricPill`, `SubScore`).
4. **Skeletons everywhere.** Async surfaces show `SkeletonLoader`, never a blank area. Zero-data
   surfaces show `EmptyState`, never a void.
5. **Mobile-first, ≥44px touch targets.** Interactive rows/controls use `min-h-touch`. Modals are
   `BottomSheet` (slides up on mobile, centered dialog on desktop).
6. **Research, not advice.** `Disclaimer` is required on any screen that surfaces ideas or scores.

## Tokens (`tokens.ts` + `globals.css` + `tailwind.config.ts`)

Colors are CSS variables so light/dark swap by flipping `[data-theme]`, not by changing classes.
One bull green, one bear red, a neutral slate scale, one accent (violet), one warn (amber).

| Concept   | Utility classes                          | Notes |
|-----------|------------------------------------------|-------|
| Surfaces  | `bg-bg` `bg-surface` `bg-surface-2`      | page → card → inset |
| Text      | `text-text` `text-muted` `text-faint`    | primary → secondary → captions |
| Direction | `text-bull` `text-bear` + `*-soft` bg    | via `direction(delta)` |
| Elevation | `shadow-elev-1..3`                       | |
| Numbers   | `.tnum`                                  | tabular-nums — always on prices/% |
| Touch     | `min-h-touch` `min-w-touch`              | 44px |

Semantic maps in `tokens.ts`: `direction()`, `STAGE` (Weinstein 1–4), `REGIME` (breadth →
position-sizing guidance), `TONE_CLASS`.

## Components

| Component | Purpose | Key props |
|-----------|---------|-----------|
| `Sparkline` | Tiny trend line; auto color from first→last | `data`, `tone?`, `showArea?` |
| `TrendBadge` | Day change with arrow + sign + color | `value`, `size?`, `variant?`, `format?` |
| `MetricPill` | **Value + required plain-English interpretation** | `label`, `value`, `interpretation`, `tone?`, `provisional?` |
| `ScoreRing` | Circular gauge for the composite / sub-scores | `value` (0–100 \| null), `size?`, `label?` |
| `SegmentedControl` | Timeframe / view switch (generic over value) | `options`, `value`, `onChange`, `size?` |
| `StockRow` | Compact list row (watchlist / screener) | `stock`, `href?`/`onClick?`, `note?` |
| `StockCard` | Idea card: identity + price + why-it-passed | `stock`, `reasons?`, `verdict?`, `href?`/`onClick?` |
| `BottomSheet` | Mobile modal (slide-up) / desktop dialog | `open`, `onClose`, `title?`, `desktopDialog?` |
| `MarketStatusBadge` | US session phase (ET) + "updated Xm ago" | `updatedAt?` |
| `SkeletonLoader` | Shimmer placeholder | `variant` (line/block/circle/card/row), `count?` |
| `EmptyState` | Zero-data guidance | `icon?`, `title`, `description?`, `action?` |
| `Disclaimer` | Research-not-advice notice | `variant` (inline/banner) |

### Server vs client

Pure presentational components (`TrendBadge`, `MetricPill`, `ScoreRing`, `SkeletonLoader`,
`EmptyState`, `Disclaimer`) are **server components** — usable anywhere. Components with hooks or
handlers are marked `"use client"`: `Sparkline` (memo), `StockRow`/`StockCard` (onClick),
`SegmentedControl`, `BottomSheet`, `MarketStatusBadge`.

## Charts (Phase 2)

`StockChart` (in `StockChart/`) is the TradingView `lightweight-charts` price
chart: candles + volume + a 150-day MA overlay, translucent Weinstein-stage
bands, and a relative-strength line in its own pane. It talks only to the
[`dataProvider`](../lib/dataProvider) and renders **pre-computed** series — the
chart itself computes nothing.

```tsx
import { StockChart } from "@/design-system";
import { dataProvider } from "@/lib/dataProvider";

const data = await dataProvider.getStockChart("NVDA"); // in a Server Component
<StockChart data={data} height={460} showVolume showRS />
```

| Prop | Meaning |
|---|---|
| `data` | `StockChartResponse \| null` — `null` + `loading` ⇒ skeleton; `null` ⇒ empty |
| `loading` / `error` | drive the skeleton / error `EmptyState` |
| `height` | default 460 (panes auto-split) |
| `showVolume` / `showRS` | default true; RS is user-toggleable in the header |
| `onCrosshairChange` | `(CrosshairPayload \| null) => void` |

**Budget:** the ~164 KB lib is imported ONLY inside `ChartCanvas`, which
`StockChart` loads via a client-side dynamic `import()` when data is ready — so it
sits in a lazy chunk, never in First Load JS and never on the server. Never
import `lightweight-charts` (or `ChartCanvas`/`StageBandPrimitive`) at module top
level in any file reachable from a Server Component. **Live demo:**
[`/dev/chart`](../app/dev/chart/page.tsx).

## Data & mock mode

Types live in [`@/lib/types`](../lib/types.ts) and mirror the planned API Pydantic models
(MIGRATION.md §3.4). [`@/lib/mock`](../lib/mock.ts) generates deterministic data for all three
regimes so the entire UI runs with **no API keys and no backend** — the demo route and (later) the
`dataProvider` mock path both build on it. Formatting helpers (`formatUSD`, `price`, `pct`) live in
[`@/lib/format`](../lib/format.ts) and mirror the Streamlit app's `humanize_usd`.

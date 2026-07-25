# MIGRATION.md

> **Project:** TechnoFunda — US stock research app
> **From:** Streamlit monolith (`streamlit_app.py`, 813 lines) + batch cron (`daily_refresh.py`) over dual-dialect SQLite/Postgres
> **To:** `/api` FastAPI (typed, `/docs`) wrapping the existing Python analysis, `/web` Next.js App Router + Tailwind + TypeScript, one server-side `dataProvider` with US-market-hours-aware caching
> **Status of this doc:** Phase 0 — inventory, contracts, and plan. No code moves until the golden-test harness in §5 is green.

---

## First principle (the bar every screen must clear)

The product exists to answer **three questions in under ten seconds**:

1. **What's moving?** — market posture, breadth regime, which sectors/themes lead. (Top-down)
2. **Is this stock worth acting on?** — one TechnoFunda verdict per name: trend + growth + ownership + valuation, with the price context. (Bottom-up)
3. **What next?** — the shortlist: screener ideas, earnings on deck, watchlist, re-rating setups. (Action)

**Every metric ships with a plain-English interpretation.** A number without a sentence is a bug. `pct_above_200ema = 62` is not a deliverable; *"62% of the liquid universe is above its 200-day line — an aggressive regime; full position sizes are reasonable"* is. This rule is load-bearing for the whole IA in §4 and the response models in §3: interpretation strings are **computed server-side** (so the funnel logic stays in one place and is golden-tested), not hand-written in React.

### The TechnoFunda composite — and where it's thin today

The product's spine is a **composite verdict** assembled from four signal families. Today only two of them actually reach the score:

| Signal family | Where it lives today | In the composite score today? | Verdict |
|---|---|---|---|
| **Technical** (trend, stage, RS-line new high, proximity to 52w high) | `add_indicators`, `stage`, `screener.rs_line_new_high` | **Yes** — `−pct_below_high×0.5 + rs_new_high×10` | Solid |
| **Growth** (revenue YoY, EPS growth ex-extra) | `fundamentals.revenue_yoy`, `company._growth` | **Yes** — `revenue_yoy` term | Solid |
| **Ownership** (IBD 50 / institutional sponsorship) | `ibd50` (FFTY ETF proxy, ~50 names, weekly) | **No** — only a `★` tag on constituents | **THIN.** Proxy for the real IBD 50, weekly cadence, lives in an ephemeral JSON file that never reaches the web tier. Not scored. |
| **Valuation** (own-history percentile, sector-relative P/E) | `rerating.rerating_scorecard` | **No** — separate scorecard, never folded in | **THIN.** Computed on a different page, never joined to the score. `pe_vs_sector` depends on FMP `sector-pe-snapshot`; per-name P/E is sparse on the free tier. |

The current `screen()` "score" is therefore **technical + growth only**:
```
score = revenue_yoy.fillna(0) − pct_below_high.fillna(50)×0.5 + rs_new_high.astype(int)×10
```
**Opinion / mandate for the port:** the API should expose a **single `CompositeScore` object per stock** that carries all four sub-scores explicitly (`technical`, `growth`, `ownership`, `valuation`) plus the blended headline, *and marks `ownership`/`valuation` as `provisional` when their inputs are missing.* That makes the thinness visible in the contract instead of silently defaulting to zero, and gives us a schema-stable place to strengthen ownership (13F/institutional feed) and valuation (fold `rerating` in) later without breaking clients. See `CompositeScore` in §3.

---

## Decisions locked (Phase 0 review)

Three product decisions confirmed after review — they amend the architecture (§3), composite (above), IA (§4), and phased plan (§5.2):

1. **Multi-user with accounts + auth.** Not single-user. Add authentication (NextAuth/Auth.js on `/web`; the API verifies the session/JWT), a `users` table, and make **`watchlist` a user-scoped resource** keyed by `user_id` (retires `watchlist.txt`). All `/watchlist*` endpoints require a valid session; the research read endpoints (regime/screener/stock/etc.) stay public or lightly gated. → New **Auth** phase inserted in §5.2 before the web scaffold; `POST /screen` gating (§3.1) folds into it.

2. **Strengthen the composite score now (not later).** All four legs must reach the headline score:
   - **Valuation** → fold `rerating_scorecard` (own-history P/E percentile + sector-relative `pe_vs_sector`) into the `valuation` sub-score.
   - **Ownership** → move IBD50 out of the ephemeral cron JSON into an **`ibd50` DB table** (also fixes the web-tier gap in §4 flag ④) and score membership (+ FFTY weight) into the `ownership` sub-score.
   - Data-quality caveats stand (FFTY is a proxy for the editorial IBD 50; free-tier per-name P/E is sparse) → keep `provisional=true` only when a given name's inputs are genuinely missing, but the legs now **contribute** to the headline instead of silently defaulting to zero. This moves the "strengthen" work **into Phases 4–5**, not post-launch.

3. **Hosting: Vercel (web) + Render (api).** `/web` Next.js on **Vercel**; `/api` FastAPI + the nightly cron on **Render**; **Neon** stays the shared Postgres. Implications baked into §3/§5.2: CORS allow-lists the Vercel domain on the API; secrets set on both platforms; OpenAPI→TS generation runs in the Vercel build; keep the API **Docker-based** so it stays portable. Pick **one** scheduler on Render (retire the GitHub Actions cron to avoid double-firing `30 11 * * *`).

---

## 1. Inventory

### 1.1 Current pages / sections

Streamlit renders **one page per run** via a sidebar radio (`PAGES`, line 298–299) — deliberate perf choice, not `st.tabs`. Eight pages; the last is dev/ops.

| # | Page (Streamlit) | Header | Purpose (funnel stage) | Snapshot-backed? | Lines |
|---|---|---|---|---|---|
| 1 | **Stock** | 🔎 Stock | One-name deep dive: price, stage, financials, concall, news (bottom-up) | Partly (live financials/news/stage) | 325–446 |
| 2 | **Market Regime** | Market Regime & Breadth | Breadth, regime, new highs/lows (top-down) | Yes (`breadth`) | 448–493 |
| 3 | **Sectors** | Sector TechnoFunda | Sector ETF ranking + constituents (top-down) | Yes (`sector_scores`, `stock_technicals`) | 495–534 |
| 4 | **Screener** | Stock Screener | Default screen + Advanced recompute (action) | Default yes (`screen_results`); Advanced live | 536–577 |
| 5 | **Re-rating** | Re-rating Scorecard | Valuation re-rating setups (action/valuation) | Yes (`rerating_scores`) | 579–588 |
| 6 | **Earnings Calendar** | Earnings Calendar | Upcoming earnings + embedded stage tool (action) | Yes (`earnings_enriched`) | 590–658 |
| 7 | **Concall** | Concall Summariser | Fetch/Paste/Stored transcript summaries | Reads `transcripts`; fires ingest from UI | 660–728 |
| 8 | **Data** | Data & Ingestion | Dev/ops: trigger refresh, ingest, IBD50. `st.stop()` in PROD | N/A (ops) | 730–813 |

### 1.2 Every data source & external API call

All HTTP funnels through `base.get_json(url, params, retries=3, timeout=30)` — one `requests.Session`, error taxonomy **401→`AuthError`** (no retry), **402/403→`RestrictedError`** (no retry, caller skips), **429→backoff `2**attempt*5`s**, **5xx/`RequestException`→backoff `2**attempt`s**. Two functions bypass it (flagged for consolidation).

| Source | Module | Function(s) | Endpoint / base | Auth | Tier / quota | Cadence → target TTL |
|---|---|---|---|---|---|---|
| **FMP** | `providers/fmp.py` | `profile`, `income_statement`, `ratios`, `key_metrics`, `quote`, `ratios_ttm`, `sector_pe`, `earnings_calendar` | `.../stable/…` (symbol is **query param** on the `/stable` surface; `/api/v3` retired 2025-08-31) | `apikey` query | **Free** (annual only) | fundamentals daily→weekly; quote intraday; calendar daily |
| **FMP (paid)** | `providers/fmp.py` | `transcript`, `company_screener`, quarterly ratios/key-metrics | same | `apikey` | **PAID → 402 `RestrictedError` on free** | guard behind paid-key detection |
| **Polygon** | `providers/polygon.py` | `grouped_daily(date)` | `/v2/aggs/grouped/locale/us/market/stocks/{date}` | `apikey` query | bulk — whole US market, one call | **breadth engine; highest-value cache target** — intraday during RTH, cache-to-next-open after close |
| **Polygon** | `providers/polygon.py` | `daily_bars(symbol,start,end)` | `/v2/aggs/ticker/{symbol}/range/1/day/{s}/{e}` | `apikey` | per-symbol history | intraday/price TTL |
| **Polygon** | `providers/polygon.py` | `financials(ticker?,…)`, `financials_next(url)` | `vX/reference/financials` (`FIN_URL`, hard-coded) | `apikey` | experimental `vX`, paginated sweep | daily→weekly |
| **Polygon** | `providers/polygon.py` | `news(ticker,limit)` | `/v2/reference/news` | `apikey` | per-symbol | 30 min |
| **Alpha Vantage** | `providers/alphavantage.py` | `earnings_transcript(sym,year,q)` | `/query?function=EARNINGS_CALL_TRANSCRIPT` | `apikey` (`demo`→IBM only) | **25 req/day HARD** — the one real external quota; HTTP-200 `Note`/`Information` throttle signal handled per-provider | **cache-forever per (sym,year,q)** (immutable once published) |
| **SEC** | `providers/sec.py` | `ticker_name_map`, `resolve_names` | `sec.gov/files/company_tickers.json` | **none**, descriptive `User-Agent` (placeholder contact — externalize) | free bulk file; **bypasses `get_json`** | 7-day file cache (exists) |
| **IBD 50 / FFTY** | `providers/ibd50.py` | `fetch_ffty_holdings`, `refresh` | HubSpot HubDB (`api.hubspot.com/…/1709801168/rows`, hard-coded table/portal IDs) | **none**, `UA: Mozilla/5.0`; **bypasses `get_json`** | fragile issuer endpoint | weekly (rebalance cadence) |
| **SIC classifier** | `providers/sic.py` | `sic_to_sector(sic)` | — **no network**, hard-coded `_RANGES` | — | pure lookup (first match wins) | n/a |
| **Anthropic** | `analysis/concall.py` | `summarise_with_claude` | Claude API (`CONCALL_LLM_MODEL`, default `claude-sonnet-5`) | `ANTHROPIC_API_KEY` | optional LLM summary | non-deterministic; separate optional endpoint |

**Config keys** (`config.py`, from `.env` via `python-dotenv`; `require(k)` raises if missing): `FMP_API_KEY`, `POLYGON_API_KEY`, `ALPHAVANTAGE_API_KEY`, `EODHD_API_KEY`, `PRICE_PROVIDER` (`"polygon"|"eodhd"`).
**Migration flags:** ① `PRICE_PROVIDER="eodhd"` branch + `EODHD_API_KEY` are referenced but **no `eodhd.py` exists** — implement or drop. ② `sec.USER_AGENT` contact + `ibd50` HubDB IDs are fragile placeholders — externalize to config. ③ `sec._fetch` and `ibd50.fetch_ffty_holdings` bypass `get_json` — consolidate onto the shared async core. ④ `_qmark`'s blind `?`→`%s` replace corrupts literal `?`/`%` — move to SQLAlchemy-parameterized queries.

### 1.3 Every computation (screens, scores, indicators)

All `src/analysis/*` functions are **pure over injected DataFrames** except the two marked ⚠️. No analysis function reads the DB directly — frames are passed in from the data layer.

| Module | Function | Kind | Output | Purity | Constants (pin in golden tests) |
|---|---|---|---|---|---|
| `indicators` | `ema`, `sma` | indicator | Series | pure | — |
| `indicators` | `rsi(window=14)` | indicator | Series | pure | **Cutler/SMA-based, NOT Wilder** |
| `indicators` | `rolling_high/low` | indicator | Series | pure | — |
| `indicators` | `add_indicators` | indicator pack | +10 cols incl. `above_ema_long/mid`, `at_52w_high`(≥hi×0.98, **hi includes today**), `at_52w_low`(≤lo×1.02), `dollar_vol`, `adv_dollar_vol`(20d) | pure | `ema_long=200, ema_mid=50, high_window=252`; 2% bands |
| `indicators` | `relative_strength(lookback=63)` | RS (**return-ratio**) | `ret, bench_ret, rs_ratio` | pure | `RS_LOOKBACK=63` — **distinct from screener RS** |
| `breadth` | `classify_regime` | regime | `aggressive/moderate/shallow` | pure | `REGIME_AGGRESSIVE=60, MODERATE=40` |
| `breadth` | `compute_breadth(min_price)` | breadth (full recompute) | `_OUT_COLS` (see §3 `BreadthRow`) | pure | `MIN_PRICE=5, MIN_DOLLAR_VOL=5e6`; **asymmetric denominators** |
| `breadth` | `incremental_breadth` | breadth (EMA-state continuation) | rows + `new_state` | pure | must equal full recompute (golden test) |
| `breadth` | `latest_regime` | latest row → dict | dict | pure | — |
| `screener` | `technical_snapshot` | latest-bar technicals | `symbol,close,ema_long/mid,rsi14,hi_52w,above_*,at_52w_high,adv_dollar_vol` | pure | — |
| `screener` | `rs_line_new_high(lookback=252,tol=0.02)` | RS (**price-level ratio**) | `(rs, is_new_high)` | pure | needs ≥5 pts |
| `screener` | **`screen(...)`** | **the composite screen** | ranked candidates + `score` | pure | mask NaN-fills **exclude** on missing fundamentals; score weights `0.5`, `10` |
| `rerating` | `valuation_history` | own-history table | `period,report_date,pe,ev_ebitda,revenue_yoy` | pure | — |
| `rerating` | **`rerating_scorecard`** | valuation setup | `pe_pctile, pe_vs_sector, rev_growth_slope, rerating_setup` | pure | `_percentile_of_last`≥4 pts; `_slope`≥3 pts; thresholds ≤50 / ≤10 / >0 |
| `sectors` | `months_above_trend` | theme-age proxy | float (÷21) | pure | — |
| `sectors` | `score_sector_etfs` | sector ETF scorecard | `etf,rsi14,pct_from_52w_high,months_above_trend,sound_not_stretched` | pure | `SECTOR_ETFS` (11 GICS→SPDR); RSI<70, months≤18 |
| `sectors` | `stock_technicals_by_sector(ibd50)` | constituents + `★` | `symbol,…,ibd50,rsi14,above_*,at_52w_high` | pure | — |
| `sectors` | `industry_growth` | industry median growth | `median_rev_growth` | pure | **aggregates ALL history rows, not latest** (confirm intended) |
| `stage` | `classify_stage(ma_window=150)` | Weinstein stage (1 symbol) | dict `stage,label,action,ma150,ma_slope_pct,range_pos,rsi14,…` | pure | `MA_WINDOW=150, SLOPE_WINDOW=20, FLAT_PCT=1.5, RANGE_WINDOW=252`; needs n≥170 |
| `stage` | `stage_snapshot` | Weinstein (vectorized) | per-symbol stage | pure | **np.select must equal `classify_stage` tree** (golden test) |
| `stage` | `stage_series` | close + ma150 for charting | date-indexed df | pure | — |
| `company` | ⚠️ `financial_history` | financials + growth | `{annual, quarterly}` frames | **impure** (2 Polygon calls) → split fetch/compute | `eps_ex_extra` guard `shares>1e7`; growth NA when prior base ≤0 |
| `company` | `latest_growth` | headline growth | dict | pure | — |
| `concall` | `split_sentences` | text → sentences | list | pure | `len>20` |
| `concall` | `summarise_transcript(max_per_bucket=6)` | heuristic summary | `{buckets, tone, n_sentences}` | pure, deterministic | `LEXICON`, `_POS/_NEG`, `_TERM_RE` (leading `\b` only); tone `×1.3`; cap `×3=18` |
| `concall` | `format_digest` | summary → markdown | str | pure | — |
| `concall` | ⚠️ `summarise_with_claude` | LLM summary | str | **impure** (Anthropic + env) | non-deterministic — do NOT golden-test output |

**Behaviors that are easy to "accidentally fix" — do not:** ① RSI is Cutler/SMA everywhere. ② Breadth asymmetric denominators (`pct_above_200ema ÷ valid-EMA universe`; `pct_above_50ema ÷ all filtered rows`). ③ Screener NaN-fills exclude on missing fundamentals. ④ `at_52w_high` = within 2% of a rolling max **including today**. ⑤ EPS growth from **$ continuing-ops earnings (split-immune)**, NA when prior base ≤0. ⑥ Two distinct "relative strength" definitions — name them differently. ⑦ `industry_growth` medians all history.

### 1.4 Every chart

| Page | Chart | Streamlit call | Data | Source logic |
|---|---|---|---|---|
| Stock | Price + 150-MA line | `st.line_chart(ch[["close","ma150"]])` (370/372) | bars close + `stage_series.ma150` | `get_stage` |
| Market Regime | % above 200/50 EMA | `st.line_chart(b[pcols])` (478) | `pct_above_200ema/50ema` | `get_breadth` |
| Market Regime | New 52w highs vs lows | `st.line_chart(hl)` (483) | `new_52w_highs/lows` | `get_breadth` |
| Market Regime | Net new highs (bar) | `st.bar_chart(net)` (487) | highs − lows | derived |
| Earnings | Stage series for picked co. | `st.line_chart(series)` (658) | `stage_series` | `get_stage` |

**Charting note for React:** all five are simple time series. Data comes from the API; rendering is client-side (Recharts/visx/lightweight-charts). No chart computes anything — the line/bar values are already in the response.

### 1.5 Every user input

| Page | Input | Widget | Line | Becomes (React) |
|---|---|---|---|---|
| Stock | Stock search | `selectbox([""]+opts)` | 329 | typeahead combobox → `GET /tickers` |
| Stock | Free symbol | `text_input().upper()` | 331 | text input (overrides combobox) |
| Stock | Load concall digest | `button` (fires ingest) | 412 | **read pre-ingested**, not UI-fired ingest |
| Market Regime | Raw breadth table | `expander` | 492 | collapsible |
| Sectors | Per-sector | `expander` | 529 | accordion |
| Screener | Industries | `multiselect` | 547 | in-memory filter (client) |
| Screener | RS-new-high only | `checkbox(value=True)` | 548 | client filter |
| Screener | Stage filter | `multiselect([1,2,3,4], default=[2])` | 557 | client filter |
| Screener | Min revenue YoY % | `number_input(15.0, key=adv_g)` | 573 | `POST /screen` body |
| Screener | Max debt/equity | `number_input(1.0, key=adv_de)` | 574 | `POST /screen` body |
| Re-rating | Only flagged setups | `checkbox(value=False)` | 586 | client filter |
| Earnings | From / To date | `text_input` (string cmp!) | 607/608 | **real date pickers** |
| Earnings | Company (stage) | `selectbox(df.symbol)` | 637 | combobox → `GET /stocks/{sym}/stage` |
| Earnings | Watchlist | file `ROOT/watchlist.txt` | 599 | user-scoped watchlist resource |
| Concall | Use Claude | `checkbox` | 668 | toggle → `use_claude` |
| Concall | Symbol/Year/Quarter + Fetch | `text/number_input` + `button` (ingest) | 691–694 | `POST /concall/summarize` (backend fetch) |
| Concall | Symbol + transcript + Summarise | `text_input`+`text_area`+`button` | 711–714 | `POST /concall/summarize` (paste) |
| Concall | Stored picker | `selectbox` | 723 | `GET /concall/transcripts` |
| Data (dev) | all ingestion buttons | `button`→`subprocess.Popen` / provider calls | 746–813 | **not in client** — cron/backend only |

**Three UI-fired-ingestion anti-patterns to kill:** Stock concall button (412), Concall Fetch (694), all Data buttons. In the new app these are backend jobs; the client only *reads* pre-ingested data or POSTs pasted text.

---

## 2. Research logic vs UI — the two-column split

**Rule:** anything under `src/analysis/*`, `src/providers/*`, `src/ingest/*`, and the snapshot tables is **RESEARCH-LOGIC → KEEP, port to FastAPI**. Everything that is layout, widgets, formatting, empty-state copy, in-memory filtering of already-fetched data, and deployment glue is **UI → rebuild in React**.

### 2.1 KEEP — port to FastAPI as pure typed functions

Each pure analysis function maps to an endpoint + Pydantic response model. Impure functions (⚠️) are split into a **fetch adapter** (dataProvider) + **pure compute** (golden-tested on fixtures).

| Analysis function | → Endpoint | Response model (sketch) |
|---|---|---|
| `breadth.compute_breadth` / `incremental_breadth` | `GET /breadth?limit=` | `list[BreadthRow]` = `{date, universe_size, pct_above_200ema, pct_above_50ema, new_52w_highs, new_52w_lows, advancers, decliners, regime, interpretation}` |
| `breadth.latest_regime` + `classify_regime` | `GET /regime` | `RegimeResponse = {regime, pct_above_200ema, new_52w_highs, universe_size, icon, sizing_text, interpretation}` |
| `sectors.score_sector_etfs` | `GET /sectors` | `list[SectorScore]` = `{etf, sector, close, above_200ema, above_50ema, rsi14, pct_from_52w_high, months_above_trend, sound_not_stretched, interpretation}` |
| `sectors.stock_technicals_by_sector` | `GET /sectors/{sector}/constituents` | `list[ConstituentRow]` = `{symbol, name, sector, industry, ibd50, close, rsi14, above_ema_long, above_ema_mid, at_52w_high}` |
| `sectors.industry_growth` | `GET /sectors/industries` | `list[IndustryGrowthRow]` = `{industry, sector, median_rev_growth}` |
| `screener.screen` | `GET /screen/default` (snapshot) + `POST /screen` (recompute) | `list[ScreenRow]` = `{symbol, name, sector, industry, close, revenue_yoy, debt_to_equity, current_ratio, roe, fcf, pe, ev_ebitda, rsi14, rs_line, rs_new_high, at_52w_high, pct_below_high, score, composite, interpretation}` |
| `screener.technical_snapshot` | (internal, feeds screen/constituents) | — |
| `screener.rs_line_new_high` | (internal, feeds screen + stock detail) | part of `ScreenRow`/`StockDetail` |
| `rerating.rerating_scorecard` | `GET /rerating` | `list[ReratingRow]` = `{symbol, name, sector, industry, pe_now, pe_median, pe_pctile, sector_pe_median, pe_vs_sector, ev_now, ev_median, rev_growth_now, rev_growth_slope, rerating_setup, interpretation}` |
| `rerating.valuation_history` | `GET /stocks/{symbol}/valuation-history` | `list[ValuationHistoryRow]` = `{period, report_date, pe, ev_ebitda, revenue_yoy}` |
| `stage.classify_stage` + `stage_series` | `GET /stocks/{symbol}/stage` | `StageResponse = {stage, label, action, close, ma150, above_ma, ma_slope_pct, range_pos, rsi14, days, series:[{date, close, ma150}], interpretation}` |
| `stage.stage_snapshot` | (internal, feeds screen/constituents) | — |
| `company.financial_history` ⚠️ (split) | `GET /stocks/{symbol}/financials` | `FinancialsResponse = {annual:[FinRow], quarterly:[FinRow], latest_growth:{period, revenue_growth, eps_growth_ex_extra, eps_ex_extra, eps_reported}}` where `FinRow = {period, report_date, revenue, net_income, clean_earnings, eps_reported, eps_ex_extra, gross_profit, operating_income, revenue_growth, eps_growth_ex_extra}` |
| `company.latest_growth` | (folded into `FinancialsResponse.latest_growth`) | — |
| `concall.summarise_transcript` + `format_digest` | `POST /concall/summarize` | `ConcallSummary = {symbol, period, buckets:{guidance,risks,growth_drivers,margins,capital_allocation}, tone:{positive, cautious, tilt}, n_sentences, digest_md, method:"heuristic"}` |
| `concall.summarise_with_claude` ⚠️ | `POST /concall/summarize?use_claude=true` (optional/async) | same shape, `method:"claude"`; falls back to heuristic on missing key |
| providers `polygon.news` | `GET /stocks/{symbol}/news?limit=` | `list[NewsItem]` = `{title, publisher, url, published_utc}` |
| providers `polygon.grouped_daily/daily_bars` | (internal → `dataProvider` → snapshots) | `GET /bars?symbols=&start=` → `BarsResponse` |
| providers `fmp.earnings_calendar` + SEC names + trailing P/E | `GET /earnings?from=&to=` (snapshot) | `list[EarningsRow]` = `{symbol, name, date, time, eps_estimate, eps_actual, rev_estimate_b, rev_actual_b, trailing_pe}` |
| providers `sec.resolve_names`, `ibd50.*`, `sic.sic_to_sector` | (internal, feed enrichment/tags) | — |
| **composite assembly (new)** | folded into `GET /stocks/{symbol}` + `ScreenRow.composite` | `CompositeScore` (see §3.4) |

**Two seams to mock in tests:** `pg.financials` (Polygon) for `financial_history`, and the Anthropic client for `summarise_with_claude`. Refactor both so the pure transform is callable on raw JSON/text fixtures.

**Snapshot tables → GET endpoints (read-hot, pre-computed by cron):** `breadth`+`breadth_state`, `sector_scores`, `stock_technicals`, `screen_results`, `rerating_scores`, `earnings_enriched`, `refresh_meta`. These are served straight (no compute); the live-compute fallbacks and the Advanced screen are the compute endpoints.

### 2.2 REBUILD — in React

Sidebar nav (radio → ≤5 tabs); all status metrics/badges; `humanize_usd` + inline `$`/`B` formatters (→ `formatUSD` util); `STAGE_COLOR` (`{1:🔵,2:🟢,3:🟠,4:🔴}`) and `REGIME_HELP` display maps (→ TS constants); all `st.columns` metric rows; all `st.dataframe`/`column_config` tables; all `st.line_chart`/`st.bar_chart` (render only); `st.tabs`/`st.expander` layout; every input widget; **in-memory filtering of already-fetched snapshots** (Screener default industries/stage/RS masks, Re-rating flag, Earnings watchlist/date) — this is fine to do client-side; empty-state/help copy; news cards.

**Streamlit/SQLite/deployment artifacts that simply vanish** behind a typed API: `st.secrets`→`os.environ` shim (→ server-side env loading), `PROD = db.IS_PG` guard (→ ingestion controls don't exist in the client), `_BOOL_COLS` 0/1→bool coercion (typed booleans), `st.cache_data` + `data_sig()` cache key (→ HTTP caching / ETag), `st.cache_data.clear()`, `subprocess.Popen` ingestion triggers (→ cron), sidebar "Keys ✅/❌" line (**drop — leaks provider config**).

---

## 3. Target architecture

```
technofunda/
├─ api/                              # FastAPI service (Python) — wraps existing src/*
│  ├─ app/
│  │  ├─ main.py                     # FastAPI() app, /docs, CORS, lifespan (load settings once)
│  │  ├─ settings.py                 # pydantic-settings; replaces config.py import-time load_dotenv+mkdir
│  │  ├─ deps.py                     # DB session, dataProvider singleton, request-scoped cache
│  │  ├─ routers/
│  │  │  ├─ meta.py                  # /meta, /health
│  │  │  ├─ market.py                # /regime, /breadth, /sectors, /sectors/{s}/constituents, /sectors/industries
│  │  │  ├─ screen.py                # /screen/default, POST /screen, /rerating
│  │  │  ├─ stocks.py                # /tickers, /bars, /stocks/{sym}(/stage|financials|news|valuation-history)
│  │  │  ├─ earnings.py              # /earnings
│  │  │  ├─ concall.py               # POST /concall/summarize, /concall/transcripts, /concall/{sym}/{period}
│  │  │  └─ watchlist.py             # /watchlist CRUD
│  │  ├─ models/                     # Pydantic response models (§3.4) — the typed contract
│  │  │  ├─ market.py  screen.py  stocks.py  earnings.py  concall.py  common.py
│  │  ├─ services/                   # thin orchestration: snapshot-first, compute-fallback
│  │  │  ├─ interpret.py             # plain-English interpretation strings (first principle)
│  │  │  └─ composite.py             # CompositeScore assembly (technical/growth/ownership/valuation)
│  │  └─ provider/
│  │     └─ data_provider.py         # SINGLE server-side dataProvider (market-hours cache) — §3.2
│  ├─ src/                           # EXISTING code, moved verbatim, made import-safe
│  │  ├─ analysis/*                  # KEEP pure fns; parameterize config constants
│  │  ├─ providers/*                 # httpx.AsyncClient core; sec/ibd50 onto shared get_json
│  │  ├─ ingest/*                    # cron-only
│  │  └─ db/*                        # database.py (SQLAlchemy-param), schema.sql (+snapshot DDL)
│  ├─ jobs/
│  │  └─ daily_refresh.py            # unchanged batch writer (cron)
│  └─ tests/
│     ├─ fixtures/*.parquet          # frozen input frames + captured provider JSON
│     └─ golden/                     # §5 old-vs-new equality tests
├─ web/                              # Next.js App Router + Tailwind + TS
│  ├─ app/
│  │  ├─ layout.tsx  page.tsx        # / = Pulse (Home)
│  │  ├─ screener/page.tsx
│  │  ├─ stocks/[symbol]/page.tsx
│  │  ├─ watchlist/page.tsx
│  │  └─ more/(earnings|concall|sectors)/page.tsx
│  ├─ components/                    # StatTile, Interpretation, StageBadge, RegimeBadge, DataTable, charts
│  ├─ lib/
│  │  ├─ api.ts                      # typed fetch client (generated from OpenAPI)
│  │  ├─ format.ts                   # formatUSD, humanize, pct
│  │  └─ constants.ts                # STAGE_COLOR, REGIME_HELP as TS
│  └─ types/api.ts                   # generated from /openapi.json
└─ MIGRATION.md
```

### 3.1 `/api` — FastAPI wrapping the existing analysis

- **Wrap, don't rewrite.** `src/analysis/*` is already pure over DataFrames; routers call those functions and serialize the result through Pydantic. No math is reimplemented in the API layer — that's what keeps golden tests meaningful.
- **Parameterize the config globals** (`EMA_LONG/MID`, `HIGH_52W`, `MIN_PRICE`, `MIN_DOLLAR_VOL`, `REGIME_*`, and the in-module `MA_WINDOW=150, SLOPE_WINDOW=20, FLAT_PCT=1.5, RANGE_WINDOW=252`, the 2% bands, `1e7` guard, tone `×1.3`, cap `×3`, score weights) into a versioned `AnalysisSettings` object loaded once at startup — not read from module globals inside a request. Responses become deterministic and versionable.
- **Import-time side effects out of the request path:** today `import config` runs `load_dotenv()` + `DATA_DIR.mkdir`. Move to `settings.py` + FastAPI `lifespan`.
- **`/docs` and `/openapi.json` are the contract.** The web client's TS types are generated from `/openapi.json` — no hand-maintained types.
- **DB access** stays in `src/db/database.py` but the new read paths use **SQLAlchemy-parameterized queries** (retire `_qmark`'s brittle `?`→`%s`). Snapshot tables get **explicit DDL + a PK/index** (they currently have none and aren't in `schema.sql`).
- **No auth in v1 is a known risk** (DEPLOY.md notes the Streamlit app is open). The one request-time path a caller can make expensive is `POST /screen` (full-universe indicator recompute) — **bound it**: cap universe size, rate-limit, and/or precompute a few threshold variants server-side.

### 3.2 The single server-side `dataProvider` with US-market-hours-aware caching

**Net-new work — there is zero market-hours awareness in the codebase today** (no NYSE/09:30/16:00/zoneinfo/holiday logic anywhere; refresh is purely cron-time-triggered at 11:30 UTC ≈ 07:30 ET, pre-open). Add a real NYSE calendar (`pandas-market-calendars` or `exchange-calendars`) — neither is a dependency yet.

`data_provider.py` is the **only** module that touches the network. It unifies all providers (including `sec._fetch` and `ibd50.fetch_ffty_holdings`, which today bypass `base.get_json`) onto one `httpx.AsyncClient` with the existing error taxonomy (`AuthError`/`RestrictedError`/backoff), and layers a **session-phase-aware cache**:

```
Phase(now_ET) ∈ { PREMARKET 04:00–09:30, RTH 09:30–16:00, POSTMARKET 16:00–20:00,
                  CLOSED (overnight), WEEKEND, HOLIDAY }
```

TTL policy by data cadence:

| Data | RTH | Pre/Post-market | Closed / Weekend / Holiday |
|---|---|---|---|
| `grouped_daily`, `daily_bars`, FMP `quote` | short TTL (e.g. 60–120s) | short TTL, flag `extended_hours` | serve last close; cache **until next session open** |
| fundamentals / `financials` / `sector_pe` | daily–weekly TTL (event-driven around earnings) | same | same |
| `earnings_calendar` | daily TTL | daily | daily |
| `earnings_transcript` (AV) | **cache-forever per (sym,year,q)** | " | " — immutable + protects the **25/day AV budget** (the one hard quota; preserve the HTTP-200 `Note`/`Information` throttle detection) |
| SEC names | 7-day (already) | " | " |
| FFTY / IBD50 | weekly (rebalance) | " | " |

- **Complements, does not duplicate, `ingest_log`.** `log_ingest`/`already_fetched` remain the batch idempotency guard; the request-time cache sits in front for read endpoints. The provider module *fetches*; `src/db/*` *persists*.
- **Snapshot-first, compute-fallback** matches today's reader: GET endpoints serve the pre-computed snapshot; the fallback path (missing snapshot) computes live via the pure analysis fn — same behavior Streamlit has, now typed.
- **Externalize the fragile placeholders** here: `sec.USER_AGENT` contact, `ibd50` HubDB table/portal IDs, `PRICE_PROVIDER` switch (drop `eodhd` or implement it).

### 3.3 Concrete endpoint list

| Method | Path | Params / body | Response model | Serves from |
|---|---|---|---|---|
| GET | `/health` | — | `HealthResponse` | liveness |
| GET | `/meta` | — | `MetaResponse` `{last_run_ist, status, regime, summary, tickers, price_bars, fundamentals, latest_bar}` | `refresh_meta` + counts |
| GET | `/tickers` | `q?` | `list[TickerOption]` `{symbol, name, market_cap, label}` | `tickers` |
| GET | `/bars` | `symbols`, `start?` | `BarsResponse` `{rows:[{symbol,date,open,high,low,close,volume}]}` | `daily_bars` |
| GET | `/regime` | — | `RegimeResponse` | snapshot `breadth` → `latest_regime` |
| GET | `/breadth` | `limit?` | `list[BreadthRow]` | snapshot `breadth` / `compute_breadth` |
| GET | `/sectors` | — | `list[SectorScore]` | snapshot `sector_scores` / `score_sector_etfs` |
| GET | `/sectors/{sector}/constituents` | — | `list[ConstituentRow]` | snapshot `stock_technicals` / `stock_technicals_by_sector` |
| GET | `/sectors/industries` | — | `list[IndustryGrowthRow]` | `industry_growth` |
| GET | `/screen/default` | `stage?`, `industries?`, `rs_new_high?` | `list[ScreenRow]` | snapshot `screen_results` (filters client-side too) |
| POST | `/screen` | `{min_growth=15, max_de=1.0, min_current_ratio=1.2, industries?}` | `list[ScreenRow]` | live `screen(bars, fund, tick, benchmark=spy)` — **bounded** |
| GET | `/rerating` | `only_flagged?` | `list[ReratingRow]` | snapshot `rerating_scores` / `rerating_scorecard` |
| GET | `/earnings` | `from?`, `to?` | `list[EarningsRow]` | snapshot `earnings_enriched` |
| GET | `/stocks/{symbol}` | — | `StockDetailResponse` (header + `CompositeScore`) | join quote+ticker+stage+regime+composite |
| GET | `/stocks/{symbol}/stage` | — | `StageResponse` | `classify_stage`+`stage_series` (Polygon fallback for thin history) |
| GET | `/stocks/{symbol}/financials` | `annual_limit?`, `quarterly_limit?` | `FinancialsResponse` | `financial_history` (live Polygon, cached) |
| GET | `/stocks/{symbol}/news` | `limit=10` | `list[NewsItem]` | `polygon.news` (cached 30m) |
| GET | `/stocks/{symbol}/valuation-history` | — | `list[ValuationHistoryRow]` | `valuation_history` |
| POST | `/concall/summarize` | `{text?}` OR `{symbol, year, quarter}`, `use_claude=false` | `ConcallSummary` | `summarise_transcript` / `summarise_with_claude` (backend fetch — **not client-fired ingest**) |
| GET | `/concall/transcripts` | `symbol?` | `list[TranscriptMeta]` `{symbol, period, date}` | `transcripts` |
| GET | `/concall/{symbol}/{period}` | — | `ConcallSummary` | stored `concall_summaries` |
| GET | `/watchlist` | (user) | `list[WatchItem]` | user-scoped resource (was `watchlist.txt`) |
| POST | `/watchlist` | `{symbol}` | `WatchItem` | add |
| DELETE | `/watchlist/{symbol}` | — | `204` | remove |

**Endpoints that are explicitly live + cached (not snapshot) — document as such:** `/stocks/{sym}/financials`, `/stocks/{sym}/news`, `/stocks/{sym}/stage` (for thin/off-universe history), `POST /concall/summarize`, `POST /screen`. The "zero-API-on-load" guarantee only ever held for Regime/Sectors/Screener-default/Re-rating/Earnings. Two hardening options for the Stock page: (a) precompute per-universe stage/financials into a snapshot too, or (b) keep them live+cached and label them. **Recommendation:** precompute per-universe **stage** into a snapshot (it's cheap and vectorized via `stage_snapshot`), keep financials/news live+cached.

### 3.4 Key Pydantic models (interpretation + composite are first-class)

```python
class Interpretation(BaseModel):        # the first-principle carrier
    headline: str                       # "Aggressive regime — full sizing reasonable"
    detail: str | None = None
    tone: Literal["good", "neutral", "bad"] = "neutral"

class SubScore(BaseModel):
    value: float | None                 # None ⇒ signal unavailable
    provisional: bool = False           # True ⇒ inputs thin (ownership/valuation today)
    interpretation: Interpretation

class CompositeScore(BaseModel):
    headline: float                     # blended TechnoFunda score
    verdict: Literal["act", "watch", "avoid"]
    technical: SubScore                  # trend/stage/RS/proximity-to-high  (SOLID today)
    growth: SubScore                     # revenue YoY + EPS-ex-extra        (SOLID today)
    ownership: SubScore                  # IBD50/sponsorship — provisional=True until DB-backed feed
    valuation: SubScore                  # rerating percentile + pe_vs_sector — provisional=True until folded in
    interpretation: Interpretation       # one plain-English verdict sentence

class RegimeResponse(BaseModel):
    regime: Literal["aggressive","moderate","shallow"] | None
    pct_above_200ema: float | None
    new_52w_highs: int; universe_size: int
    icon: str; sizing_text: str
    interpretation: Interpretation

class StageResponse(BaseModel):
    stage: int | None; label: str; action: str
    close: float; ma150: float | None; above_ma: bool
    ma_slope_pct: float | None; range_pos: float | None
    rsi14: float | None; days: int
    series: list[StagePoint]             # {date, close, ma150} for the chart
    interpretation: Interpretation
```
`ScreenRow`, `ReratingRow`, `BreadthRow`, `SectorScore`, `FinancialsResponse`, `ConcallSummary`, `EarningsRow` follow the column sets in §1.3 / §2.1, each ending in an `interpretation: Interpretation`. Booleans are real booleans (no SQLite 0/1). `interpret.py` centralizes the sentence generation so it is golden-tested alongside the numbers.

---

## 4. Information architecture — max 5 tabs, mapped to the funnel

The old 8-way radio collapses to **five tabs** that mirror the research funnel *what's moving → what's worth acting on → is this one worth it → track it → everything else*. **Data** dissolves entirely (ingestion is cron; its "Data as of" badge becomes a small global header element, already the sidebar caption at lines 305–315). Every screen leads with a plain-English answer to its funnel question.

| # | New tab | Funnel question (<10s answer) | Old Streamlit page(s) | API endpoints consumed |
|---|---|---|---|---|
| 1 | **Pulse** (Home) | *What's moving?* | Market Regime **+** Sectors | `GET /meta`, `/regime`, `/breadth`, `/sectors`, `/sectors/industries` |
| 2 | **Screener / Ideas** | *What's the shortlist?* | Screener **+** Re-rating | `GET /screen/default`, `POST /screen`, `GET /rerating`, `/sectors/{s}/constituents` |
| 3 | **Stock Detail** | *Is this stock worth acting on?* | Stock (+ Concall Fetch folded in) | `GET /stocks/{sym}`, `/stage`, `/financials`, `/news`, `/valuation-history`, `POST /concall/summarize` |
| 4 | **Watchlist** | *What do I already track — what next?* | Earnings watchlist **+** per-stock stage | `GET /watchlist`, `/earnings`, `/stocks/{sym}/stage`, `/stocks/{sym}` |
| 5 | **More** | *Everything else* | Concall (Paste/Stored) + Earnings full + Sectors deep + Industries | `GET /earnings`, `/concall/transcripts`, `/concall/{sym}/{period}`, `POST /concall/summarize`, `/sectors/industries` |

**Design opinions per tab:**

- **Pulse** — top: `RegimeBadge` (icon + one sizing sentence). Below: two breadth sparklines (% above 200/50 EMA; net new highs) and the sector leaderboard ranked by ETF RSI with `sound_not_stretched` chips. This *is* "what's moving," answered above the fold. Interpretation strings from `/regime` and each `SectorScore`.
- **Screener / Ideas** — the default screen (snapshot) with **client-side** industry/stage/RS filters (no round-trip). Re-rating rides as a second view/preset on the same table (both are ranked stock lists). Each row shows the `CompositeScore.verdict` chip and its one-sentence interpretation. "Advanced" = `POST /screen` (bounded).
- **Stock Detail** — the money page: header stat row (price+chg, market cap, sector, **StageBadge**, **RegimeBadge**) then the **CompositeScore card** with all four sub-scores (technical/growth solid; ownership/valuation shown as `provisional` chips where thin). Price+150MA chart, Annual/Quarterly financials tabs, concall digest (read pre-ingested; summarize-on-demand), news cards. Concall's per-stock Fetch case lives *here*, not on a separate tab.
- **Watchlist** — the user's tracked names as cards, each with next earnings date, current stage, and composite verdict — the "what next" surface. Replaces the `watchlist.txt` file with a real resource.
- **More** — standalone Concall (Paste/Stored generic flow justifies its own space), the full earnings calendar with **real date pickers** (not string `text_input`), industry growth, and sector deep-dives.

**Porting flags carried into the IA:** ① three UI-fired ingestion paths (Stock concall 412, Concall Fetch 694, Data buttons) become read-of-pre-ingested / backend jobs. ② Earnings date filters → real date pickers. ③ Drop the "Keys ✅/❌" provider-config leak. ④ IBD50 must move to the DB — today it writes an ephemeral cron-filesystem JSON that never reaches the web tier, so the web-side `ibd50_symbols()` fallback would see an empty set and every `★` ownership tag would vanish.

---

## 5. Migration plan & golden tests

### 5.1 Preserving exact analysis outputs — the golden-test harness

The migration's success criterion is **byte-for-byte identical analysis output**, old vs new, on frozen fixtures. Because 6 of 8 analysis modules are already pure functions over injected DataFrames, we test the pure core directly — no DB, no network.

**Fixtures (freeze once, commit):**
- Small `daily_bars`, `fundamentals`, `tickers`, `benchmark_bars (SPY/QQQ)` frames as `parquet`/`csv` under `api/tests/fixtures/`.
- Captured raw provider JSON: Polygon `vX/financials` results (for `financial_history`), FFTY HubDB rows, SEC tickers file slice, one AV transcript payload.

**Golden assertions (`api/tests/golden/`):**
1. **Pure-core equality** — call each `src/analysis/*` function on the fixture frame; assert the **API endpoint** returns the same values (compare the serialized model's numeric fields to the DataFrame, `assert_frame_equal`/exact-dict). Covers breadth, sectors, screener, rerating, stage, indicators, and the pure concall functions.
2. **Pin every magic number** — parameterize the constants (§3.1) but default them to today's values; a test asserts the defaults (`EMA_LONG=200`, `EMA_MID=50`, `HIGH_52W=252`, `RS_LOOKBACK=63`, `REGIME_AGGRESSIVE=60`, `REGIME_MODERATE=40`, `MIN_PRICE=5`, `MIN_DOLLAR_VOL=5e6`, `MA_WINDOW=150`, `SLOPE_WINDOW=20`, `FLAT_PCT=1.5`, `RANGE_WINDOW=252`, bands `0.98`/`1.02`, guard `1e7`, tone `×1.3`, cap `×3`, weights `0.5`/`10`). Any drift fails.
3. **`incremental_breadth == compute_breadth`** on overlapping dates (the EMA-state continuation must match full recompute exactly — it's an exact `adjust=False` recursion).
4. **`stage_snapshot == classify_stage`** — loop every symbol through both the vectorized `np.select` and the scalar decision tree; assert equal stage/label. They implement the same tree twice and must not diverge.
5. **Behavior-lock tests** (the "don't accidentally fix" list): RSI stays Cutler/SMA (assert against a hand-computed vector, not Wilder); breadth asymmetric denominators; screener NaN-fills exclude on missing fundamentals; `at_52w_high` uses a rolling max including today; EPS growth from $ continuing-ops (split-immune), NA when prior base ≤0; the two RS definitions produce their two distinct numbers; `industry_growth` medians all history.
6. **Impure seams** — mock `pg.financials` with captured JSON and assert the pure `_rows`/`_growth` half; for `summarise_with_claude`, **do not test output** (non-deterministic) — test only the fallback path (missing key → `summarise_transcript`) and prompt construction.
7. **Interpretation strings** — snapshot-test `interpret.py` outputs so the plain-English layer is versioned like the numbers.

**Baseline capture:** before touching anything, run the existing Streamlit helper functions on the fixtures and serialize their outputs to `fixtures/expected/*.json`. The new API tests assert against these frozen expectations, so "old vs new" is a literal file comparison in CI.

### 5.2 Phased sequence

| Phase | Goal | Work | Exit criterion |
|---|---|---|---|
| **0** | This document | Inventory, contracts, IA, test plan | MIGRATION.md reviewed; fixtures + `expected/*.json` captured |
| **1** | Make analysis import-safe & parameterized | Move `config` side effects to `settings.py`; parameterize constants into `AnalysisSettings`; split the two impure fns (`financial_history`, `summarise_with_claude`) into fetch-adapter + pure compute | Golden tests 1–6 green against **unmodified** logic |
| **2** | dataProvider + async providers | One `httpx.AsyncClient` core; consolidate `sec._fetch` & `ibd50.fetch_ffty_holdings` onto it; add NYSE-calendar market-hours cache; externalize UA/HubDB IDs; decide `eodhd` (implement or drop) | Provider parity tests; cache TTLs behave per phase (RTH/pre/post/closed) |
| **3** | FastAPI read endpoints (snapshot-first) | Routers for `/meta`, `/regime`, `/breadth`, `/sectors*`, `/screen/default`, `/rerating`, `/earnings`, `/tickers`, `/bars`; Pydantic models; explicit snapshot DDL + PK/index; SQLAlchemy-param reads; `/docs` live | Golden equality: every GET endpoint == snapshot/pure-fn output |
| **4** | FastAPI compute + stock endpoints | `POST /screen` (bounded), `/stocks/{sym}(/stage/financials/news/valuation-history)`, `/stocks/{sym}` composite, `POST /concall/summarize`; `CompositeScore` assembly with provisional flags; interpretation layer | Stock-page endpoints match Streamlit live-compute on fixtures; composite marks ownership/valuation provisional |
| **5** | Move IBD50 to the DB | New `ibd50` table + cron writes it (not ephemeral JSON); ownership tag survives to web tier | `★` tags render from DB; web fallback non-empty |
| **6** | `/web` Next.js scaffold | App Router routes for the 5 tabs; generate TS types from `/openapi.json`; typed `api.ts`; `format.ts`, `constants.ts`; StatTile/Interpretation/StageBadge/RegimeBadge/DataTable/charts | Each tab renders from real endpoints; three-question test: Pulse/Detail/Screener each answer in <10s |
| **7** | Cutover & harden | Point cron at the same snapshot tables (unchanged `daily_refresh.py`); pick **one** scheduler (Render cron *or* GitHub Actions — both fire `30 11 * * *` today); add auth in front of `POST /screen`; remove dead paths (`refresh_sector_etfs`, `ingest/calendar.py`+`earnings_calendar` table, redundant `except (RestrictedError, Exception)`) | Streamlit retired; CI golden suite green; one scheduler; no client-fired ingestion |

**Rollback stance:** Phases 1–5 are backend-only and additive — the Streamlit app keeps running against the same DB throughout. The web app (Phase 6) reads the new API in parallel with Streamlit until Phase 7 cutover, so there is no big-bang switch. The golden suite is the gate on every phase: if old ≠ new, the phase does not merge.

### 5.3 Known risks to track through the migration

- **`refresh_fundamentals` is destructive** (`DELETE FROM tickers/fundamentals` then repopulate). A sweep silently truncated at `max_pages=600` rebuilds from a partial universe with no rollback. Add a row-count sanity gate before the DELETE.
- **Snapshot tables have no schema contract** — created ad hoc by `to_sql(if_exists="replace")`, no PK/index on read-hot tables. Phase 3 gives them explicit DDL.
- **AV 25 req/day** is the only hard external quota — the cache-forever transcript policy and HTTP-200 throttle detection are non-negotiable.
- **No auth (v1)** — `POST /screen` is the one caller-expensive path; bound it in Phase 4, gate it in Phase 7.
- **Ownership & valuation are thin** — the composite ships them `provisional` until (ownership) a DB-backed institutional/IBD feed and (valuation) folding `rerating` into the score land as fast-follows.
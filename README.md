# US Stocks — TechnoFunda Screener

A top-down + bottom-up screener for US equities:

1. **Market regime** — breadth (% above 200EMA, new 52-week highs, A/D) on
   Nasdaq/S&P universe → maps to a **position-sizing posture**
   (aggressive / moderate / shallow).
2. **Sector & industry** — technical scorecard on sector ETFs + industry
   revenue-growth ranking → find *technically sound but not stretched* groups,
   avoiding themes running > 18 months.
3. **Stock screen** — inside chosen industries, filter on trend (above
   200/50EMA), revenue growth, and balance-sheet strength (debt/equity, current
   ratio). Valuation is shown but never filters — you decide on price.
4. **Earnings & concalls** — earnings calendar view + transcript store for
   tracking guidance, risks, and re-rating potential.

## Data providers

| Need | Provider | Plan |
|---|---|---|
| Fundamentals, ratios, sector P/E, earnings calendar | **Financial Modeling Prep** (`/stable/` API) | free → ~$22/mo |
| Bulk daily bars (whole US market) for breadth + technicals | **Polygon.io** (grouped daily) | free → ~$29/mo |
| **Earnings-call transcripts (concalls)** | **Alpha Vantage** `EARNINGS_CALL_TRANSCRIPT` | **free** (25/day) |
| Company names for the earnings calendar | **SEC** `company_tickers.json` | free (no key) |
| Alt bulk EOD | EODHD | ~$20/mo |

Get keys, then `cp .env.example .env` and fill them in. The Alpha Vantage key
is free (email only, no card): https://www.alphavantage.co/support/#api-key —
leave it blank to use the shared `demo` key, which only works for **IBM**.

### What the FMP free tier actually allows

Verified against a live free key (the code is built around these limits):

| Endpoint | Free | Notes |
|---|---|---|
| `profile` (sector/industry/mktcap) | ✅ | one call per symbol — powers the watchlist universe |
| `income-statement` | ✅ | **annual, last 5 years** (quarterly & >5yr are paid) |
| `ratios`, `key-metrics` | ✅ | **annual only** |
| `earnings-calendar`, `sector-pe-snapshot` | ✅ | |
| Fundamentals for **all** symbols | ⚠️ | free covers a **subset** (mega-caps); others return 402 and are **skipped gracefully** |
| `company-screener`, `stock-list` (bulk universe) | ❌ paid | so the universe is built from `watchlist.txt` instead |
| `earning-call-transcript` | ❌ paid | **use Alpha Vantage instead (free)** — see below |

**Concalls are free via Alpha Vantage**, not FMP. The Concall page (and
`ingest-transcript`) fetch from `EARNINGS_CALL_TRANSCRIPT` (25/day free), store
the text, and run the guidance/risks/drivers digest. FMP transcripts remain a
paid fallback (`source="fmp"`).

Breadth needs whole-market prices and is sourced from **Polygon**, independent
of FMP — so limited FMP fundamentals don't block the regime/breadth analysis.

## Setup (Windows PowerShell)

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # then edit .env with your keys
python -m src.cli init-db
```

## Backend daily refresh (5 PM IST) — pages make no live API calls

`daily_refresh.py` is the backend job. It incrementally ingests the latest
market bars, then **pre-computes every page's dataset** into snapshot tables so
the Streamlit app only ever reads the DB — page loads make **zero API calls**.

Snapshot tables it writes each run: `breadth`, `sector_scores`,
`stock_technicals` (technicals + stage + RS + IBD50), `screen_results`,
`rerating_scores`, `earnings_enriched` (name + consensus EPS + revenue $B +
trailing P/E), and `refresh_meta` (the "Data as of …" stamp).

**Scheduled** via Windows Task Scheduler (task `USStocksDailyRefresh`) at
**17:00 IST daily**. Set up / inspect / change:

```powershell
schtasks /Create /TN "USStocksDailyRefresh" /TR "C:\Users\agraw\Desktop\us stocks\run_refresh.bat" /SC DAILY /ST 17:00 /F
schtasks /Query  /TN "USStocksDailyRefresh" /FO LIST
schtasks /Run    /TN "USStocksDailyRefresh"     # run once now
```

Run it manually anytime: `python daily_refresh.py` (or the Data tab's
"↻ Run backend refresh now" button). Output logs to `data/refresh.log`.

**Speed.** Breadth is computed **incrementally**: each symbol's 200/50-EMA is
continued from a stored `breadth_state` table (an `adjust=False` EWM is a plain
recursion, so this is exact — matches a full recompute), and only *new* trading
days are computed from a trailing window. So a daily run either **skips** breadth
(no new day → ~3s) or adds one day from a trailing window; the other snapshots
load just the classified universe, not the whole market. Typical daily run is
~1–2 min; the whole snapshot step is ~2.5s when breadth is already current.
(First run bootstraps the EMA state with one full pass.)

## Quick start: one-shot pipeline

Once your keys are in `.env`, run the whole flow with a single command:

```powershell
python bootstrap.py --dry-run                      # preview the plan, no API calls
python bootstrap.py --fundamentals-top 40          # full run (~18mo bars + top-40 fundamentals)
python bootstrap.py --skip-prices --skip-fundamentals   # recompute analysis only
```

`bootstrap.py` runs: init-db -> universe -> sector ETFs -> daily bars ->
fundamentals -> breadth -> sectors -> screen -> rerating, printing each result.
It does a **key preflight**, defaults to an ~18-month bar window (enough for
200EMA / 52-week), and **throttles** API calls (`--throttle 13`, tuned for
Polygon's 5/min free tier — set `--throttle 0` on a paid plan). Heads-up: a
full grouped-daily backfill is ~375 weekday calls, so on the free tier the
first run takes a while; upgrade or narrow `--start/--end` to speed it up.

The step-by-step commands below are the same stages if you'd rather run them
individually.

## Typical workflow

```powershell
# 1. Build the universe from watchlist.txt (free: one profile call per symbol).
#    Edit watchlist.txt to add the names you want. Paid users: --use-screener.
python -m src.cli ingest-universe

# 2. Ingest ~1.5 years of daily bars so 200EMA / 52w windows are valid
python -m src.cli ingest-prices --start 2025-01-01 --end 2026-07-21

# 3. Market regime -> position sizing
python -m src.cli breadth

# 4. Sector technofunda (ingest sector ETFs into daily_bars first)
python -m src.cli sectors

# 5. Fundamentals (annual, free-tier symbols) for names you care about, then screen
python -m src.cli ingest-fundamentals NVDA MSFT AMD
python -m src.cli screen --industry "Semiconductors" --min-growth 15

# 6. Earnings calendar
python -m src.cli ingest-calendar --from 2026-07-22 --to 2026-08-22

# 7. Re-rating scorecard (needs fundamentals across several quarters)
python -m src.cli rerating --setups-only

# 8. Concall digest (needs a transcript ingested first)
python -m src.cli ingest-transcript NVDA 2026 1   # via ingest.calendar
python -m src.cli concall NVDA --year 2026 --quarter 1          # heuristic, free
python -m src.cli concall NVDA --year 2026 --quarter 1 --llm    # Claude summary
```

### Re-rating (`src/analysis/rerating.py`)
Compares each stock's **current** P/E and EV/EBITDA against two anchors: its
**own history** (percentile — is today cheap vs its normal range?) and its
**sector** peers (discount/premium). Flags `rerating_setup = True` when a name
is cheap-vs-self, not expensive-vs-peers, and growth is accelerating — the
classic multiple-expansion candidate. Valuation informs, it never auto-excludes.

### Concall summariser (`src/analysis/concall.py`)
Turns a raw transcript into a trackable digest bucketed into **guidance, risks,
growth drivers, margins, capital allocation**, plus a positive/cautious tone
tilt. Two modes:
- **Heuristic** (default, free, deterministic) — keyword sentence extraction.
- **Claude** (`--llm`) — set `ANTHROPIC_API_KEY` and `pip install anthropic`
  for a narrative summary incl. a "re-rating watch" note. Falls back to the
  heuristic if the key/package is missing. Model via `CONCALL_LLM_MODEL`
  (default `claude-sonnet-5`).

Digests are stored in the `concall_summaries` table so you can track how
guidance and tone shift quarter over quarter.

## Layout

```
config.py                # keys, paths, tunable thresholds
src/
  providers/             # API clients (fmp, polygon) + shared HTTP
  db/                    # sqlite schema + access layer
  ingest/                # prices, fundamentals, calendar, transcripts
  analysis/              # indicators, breadth, sectors, screener
  cli.py                 # command-line entry point
data/screener.db         # local SQLite store (gitignored)
```

## Notes & next steps

- **Breadth needs the whole universe.** The Polygon *grouped daily* endpoint
  returns all US stocks for one date in a single call — the efficient path.
  Budget local storage for a rolling ~1.5 years of bars.
- **Theme age (< 18 months)** isn't an API field. `sectors.py` approximates it
  from how long price has held above its 200EMA; refine this to your taste.
- **Re-rating check** — `fundamentals` stores P/E and EV/EBITDA over time;
  compare current multiples vs the stock's own history and its sector P/E
  (`fmp.sector_pe`). A dedicated `rerating.py` is a good next module.
- **Concall analysis** — transcripts are stored raw; a summariser (extract
  guidance / risks) is a natural follow-on, and something Claude can help with.
- Not investment advice — this is tooling for your own analysis.
```

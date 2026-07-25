# TechnoFunda API

FastAPI backend that serves the **exact camelCase contract** the web app's
`realProvider` fetches (see `web/src/lib/dataProvider/realProvider.ts` and
`MIGRATION.md` §3.3). It wraps the existing Python analysis (`src/analysis/*`)
and reads the nightly-refreshed snapshot tables, computing the stock chart live
from `daily_bars`.

## Design

- **Snapshot-first.** `/meta`, `/regime`, `/breadth`, `/sectors`, `/screen/default`,
  `/rerating`, `/earnings`, `/tickers` read the pre-computed tables. The stock
  chart (`/stocks/{sym}?chart=1`) is computed live from `daily_bars` + the SPY
  benchmark via `api/chart.py` — a Python port of the parity-tested `analysis.ts`,
  so the chart, screener row and composite all agree.
- **Composite** (`api/composite.py`) mirrors the web's `composite.ts`: technical
  (from the chart), growth (revenue + net-income-proxy YoY), ownership (IBD50),
  valuation (re-rating percentile). Provisional legs count at full weight.
- **Interpretations** (`api/interpret.py`) — the API generates every plain-English
  sentence the web renders (no naked numbers).
- **Dual-dialect DB.** Reuses `src/db/database.py`: SQLite locally (`DB_PATH`),
  Postgres in prod (`DATABASE_URL`). All responses pass through a recursive
  NaN/numpy sanitizer.

## Run locally

```bash
# from the repo root
pip install -r requirements.txt
DB_PATH=data/screener_prod.db python -m uvicorn api.main:app --port 8000 --reload
```

- Interactive docs: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>

## Point the web at it

```bash
# web/.env.local
NEXT_PUBLIC_DATA_MODE=api
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Then `cd web && npm run dev`. Without these two vars the web falls back to its
built-in mock (no backend needed) — the mock IS the same wire shape.

## Endpoints (grouped)

| Group | Endpoints |
|---|---|
| Pulse | `GET /meta` `/regime` `/breadth` `/sectors` `/sectors/industries` |
| Screener | `GET /screen/default` · `POST /screen` · `GET /rerating` `/sectors/{sector}/constituents` |
| Search + Detail | `GET /tickers?q=` · `/stocks/{sym}` (`?chart=1` for the chart) · `/stocks/{sym}/stage` `/financials` `/valuation-history` `/news` |
| Earnings + Concall | `GET /earnings` `/concall/transcripts` `/concall/{sym}/{period}` · `POST /concall/summarize` |
| Watchlist | `GET /watchlist` (client-scoped until auth; returns empty in api mode) |

## Live data (`api/live.py`, TTL-cached)

Beyond the nightly snapshot, the stock-detail endpoints fetch live and cache:

- **News** — Polygon `/v2/reference/news` with per-ticker **insight sentiment**
  (falls back to a title heuristic). `GET /stocks/{sym}/news`.
- **Financials** — Polygon `vX/financials`, **annual + quarterly**, with the
  real **diluted EPS** (not a proxy) and YoY vs the same period a year prior.
- **~5-year daily history** — from **FMP** (Polygon's tier caps at ~2y), so the
  daily/weekly charts span 5 years. `GET /stocks/{sym}?chart=1&tf=1d`.
- **Multi-timeframe** — `tf` ∈ `15m` / `1h` / `4h` / `1d` / `1w`. 1d/1w carry the
  full Weinstein stage + RS + MA (weekly uses a 30-week MA); intraday (Polygon,
  delayed) is candles + volume only, since Weinstein is a daily-to-weekly concept.

## Per-user watchlist

A real DB-backed resource (`user_watchlist` table) scoped by an **`X-User-Id`**
header. The web sends a stable anonymous id (localStorage `tf-uid`) until real
auth lands, when that id becomes the authenticated user. `GET /watchlist`,
`POST /watchlist {symbol}`, `DELETE /watchlist/{symbol}` — each isolated per user.

## Remaining limits

- **Auth** — the watchlist is per-anonymous-id, not per-login (no accounts yet).
- **Concall summaries** — `POST /concall/summarize` is a heuristic; the stored
  `concall_summaries` table is empty in this DB.
- Live provider calls depend on the FMP/Polygon keys in `.env` and their rate
  limits; results are cached (news 30m, financials 24h, daily 1h, intraday 5m).

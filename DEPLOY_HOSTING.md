# Hosting the TechnoFunda web app + API

Deploys the new stack: **Next.js web on Vercel** + **FastAPI on Render** + the
**existing Neon Postgres** (kept fresh by the GitHub Actions nightly refresh).

```
┌────────────┐   NEXT_PUBLIC_API_URL   ┌──────────────┐   DATABASE_URL   ┌──────────┐
│  Vercel    │ ──────────────────────► │   Render     │ ───────────────► │   Neon   │
│  (web)     │      (browser + SSR)    │  (FastAPI)   │   + FMP/Polygon  │ Postgres │
└────────────┘                         └──────────────┘   (live fetches)  └──────────┘
```

The steps below need **your** Render/Vercel accounts and your Neon/API-key
values — I can't create accounts or enter credentials for you. Everything in the
repo (`render.yaml`, `requirements-api.txt`, CORS/env code) is already prepared.

---

## 0. Before you start

- **Rotate the API keys** (FMP, Polygon, Alpha Vantage, EODHD). They appeared in
  earlier logs, so treat them as compromised before the app is public. Put the
  **new** values into Render (step 1), not the old ones.
- Have your **Neon connection string** ready (the value in `.neon_url`). It's
  already populated with current data (breadth through the last refresh).
- Neon stays fresh automatically via the existing **GitHub Actions** cron — no
  action needed there.

Deploy order matters (each side needs the other's URL): **API first → web →
then wire CORS back to the API.**

---

## 1. API on Render

**Option A — Blueprint (recommended).** In Render → **New → Blueprint**, pick this
repo. It reads `render.yaml` and creates the `technofunda-api` web service
(`uvicorn api.main:app`, health check `/health`).

**Option B — Manual.** New → **Web Service** → this repo, then set:
- Build: `pip install -r requirements-api.txt`
- Start: `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
- Health check path: `/health`

Then in the service's **Environment** tab set (all as secrets):
| Key | Value |
|---|---|
| `DATABASE_URL` | your Neon connection string |
| `CORS_ORIGINS` | leave blank for now (fill in step 3) |
| `FMP_API_KEY` | new key |
| `POLYGON_API_KEY` | new key |
| `ALPHAVANTAGE_API_KEY` | new key (optional) |
| `EODHD_API_KEY` | new key (optional) |

Deploy, then verify:
```
curl https://<your-api>.onrender.com/health          # {"status":"ok",...}
curl https://<your-api>.onrender.com/meta             # real regime + universe
```
Copy the service URL (e.g. `https://technofunda-api.onrender.com`).

> Render's free plan sleeps after ~15 min idle (first request cold-starts ~30s).
> Bump to a paid instance for always-on. Choose the region nearest your Neon DB.

---

## 2. Web on Vercel

New Project → import this repo, then:
- **Root Directory** → `web` (important — the Next.js app lives in `web/`).
- Framework preset: **Next.js** (auto-detected).
- **Environment Variables** (Production + Preview):
  | Key | Value |
  |---|---|
  | `NEXT_PUBLIC_DATA_MODE` | `api` |
  | `NEXT_PUBLIC_API_URL` | your Render API URL from step 1 |

  These are build-time (`NEXT_PUBLIC_*`), so set them **before** the first build.
  Without them the app falls back to its built-in mock (still deploys fine).

Deploy, then note your Vercel URL (e.g. `https://technofunda.vercel.app`).

---

## 3. Wire CORS back to the API

Browser calls from the web (search, watchlist, timeframe switches) hit the API
directly, so the API must allow the Vercel origin. In Render → the API service →
**Environment**, set:
```
CORS_ORIGINS = https://technofunda.vercel.app
```
(Comma-separate multiple origins — e.g. add your custom domain. No trailing slash.)
Save → Render redeploys. `localhost:*` is always allowed for local dev.

---

## 4. Verify end to end

Open the Vercel URL:
- **Pulse** shows the real regime + sector leaderboard.
- **Screener** lists the real shortlist with composite verdicts.
- **Stock detail** (`/stocks/NVDA`) shows the 5-year chart, the timeframe
  switcher (15m/1h/4h/1d/1w), live news, and annual/quarterly financials.
- Tap the ★, then open **Watchlist** — it persists via the API (per-user by the
  `X-User-Id` the browser sends).

Browser console should be clean. If watchlist/search calls fail with a CORS
error, re-check `CORS_ORIGINS` (exact origin, no trailing slash).

---

## Notes

- **Costs:** Neon free (512 MB — the data fits), Vercel Hobby (free), Render free
  (sleeps) or Starter (~$7/mo, always-on). Nothing here requires a paid tier to
  function.
- **Data freshness:** the GitHub Actions cron refreshes Neon nightly; the API
  reads it live. Live news/financials/intraday come straight from FMP/Polygon
  (cached in-process).
- **Watchlist:** per anonymous browser id today. When you add real login, map
  that id to the authenticated user — no schema change needed.

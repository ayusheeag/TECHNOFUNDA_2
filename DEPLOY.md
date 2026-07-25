# Deploying to Render (Postgres + web + cron)

The app is dual-dialect: **SQLite locally, Postgres in production** (auto-selected
by the `DATABASE_URL` env var). Architecture: one **Web Service** (Streamlit) +
one **Cron Job** (nightly refresh) + one **managed Postgres**, all sharing the
same `DATABASE_URL`.

## 0. Before anything: rotate your API keys 🔒
Your live FMP / Polygon / EODHD keys were used locally and appeared in logs.
**Rotate them** (issue new keys in each provider's dashboard) before the app is
public, and put the NEW keys only in Render (never commit `.env`).

## 1. Push the repo to GitHub
Confirm `.env`, `data/*.db`, and `data/*.json` are gitignored (they are). The
485 MB DB is NOT committed — you seed Postgres in step 4.

## 2. Create the Render services (Blueprint)
Render → **New → Blueprint** → point at this repo. `render.yaml` provisions:
- Postgres `screener-db` (verify the plan's storage fits ~0.5–1 GB; scale up if needed)
- Web `technofunda-web` (Standard, 2 GB)
- Cron `technofunda-refresh` (`30 11 * * *` UTC = 5 PM IST)

## 3. Set the API keys
On BOTH `technofunda-web` and `technofunda-refresh` → Environment, add:
`FMP_API_KEY`, `POLYGON_API_KEY`, `ALPHAVANTAGE_API_KEY`, `EODHD_API_KEY`
(`DATABASE_URL` and `APP_ENV=prod` are set automatically by the blueprint).

## 4. Seed Postgres with your local data (one-time)
In the Render Postgres page, copy the **External Database URL**. Locally:
```powershell
$env:DATABASE_URL="postgresql://user:pass@host/dbname"   # the EXTERNAL url
.\.venv\Scripts\python.exe migrate_to_postgres.py
```
This creates the schema and copies every table (daily_bars ~4.5M rows → a few
minutes over the network). Verify row counts print at the end.

## 5. Deploy & verify
- The web service boots on `streamlit run streamlit_app.py --server.port $PORT ...`.
- Open the URL: pages should load from the seeded snapshots (regime, screener,
  stock search) with **no API calls**.
- The cron runs nightly; trigger it once manually (Render → cron → "Run") and
  check its logs end with `=== done (ok) ===` and the sidebar "Data as of"
  timestamp updates.

## Notes / gotchas
- **Always-on required:** the web service must be a paid instance (free spins
  down). The cron is separate and only bills for run time.
- **Memory:** Standard (2 GB) is chosen because the nightly `compute_snapshots`
  loads the full universe's bars. If you ever see OOM, scale the web/cron plan.
- **Fundamentals endpoint:** Polygon's `vX/reference/financials` is flagged
  legacy but currently serves data. If it's ever disabled, fundamentals + the
  Stock page's financial history freeze — fix by adding Polygon's $29/mo
  Financials add-on (same code path) or repoint to FMP.
- **Auth:** the app has no login. The heavy-job buttons are hidden in prod
  (`APP_ENV=prod`), but consider putting the whole app behind Render's access
  control or a password if the URL is shared.
- **No API purchase is required to launch** — all providers run on free tiers.

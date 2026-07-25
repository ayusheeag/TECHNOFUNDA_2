# Free deploy: Streamlit Community Cloud + Neon Postgres + GitHub Actions

Zero-cost hosting. Three free pieces, wired by one shared `DATABASE_URL`:

| Piece | Service | Cost |
|---|---|---|
| Web app | **Streamlit Community Cloud** | free |
| Database | **Neon** Postgres (serverless) | free (~0.5 GB) |
| Nightly refresh (5 PM IST) | **GitHub Actions** cron | free |

The code is already dual-dialect (SQLite locally, Postgres in prod via
`DATABASE_URL`), and `streamlit_app.py` copies Streamlit secrets into env vars,
so nothing else needs changing.

---

## 0. Rotate your API keys 🔒
Your FMP / Polygon / EODHD keys were used locally and appeared in logs. Issue
**new** keys in each provider dashboard. Put the new ones only in Neon/Streamlit/
GitHub secrets below — never commit `.env`.

## 1. Create the Neon Postgres database
1. neon.tech → new project → copy the **connection string** (looks like
   `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`).
2. Seed it with your local data (one-time, from this folder):
   ```powershell
   $env:DATABASE_URL="postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require"
   .\.venv\Scripts\python.exe migrate_to_postgres.py
   ```
   This creates the schema and copies every table (incl. `breadth_state`, so
   prod takes the fast incremental path). `daily_bars` is ~4.5M rows → a few
   minutes. Watch Neon's storage; the free tier is ~0.5 GB (your data is
   ~0.25–0.4 GB — fits, but it grows ~0.7 MB/day).

## 2. Push the repo to GitHub
Confirm `.env`, `data/*.db`, `data/*.json` are gitignored (they are).
A **public** repo gives unlimited free Actions minutes; a private repo has a
generous monthly budget (this job uses ~4 min/day).

## 3. Deploy the web app on Streamlit Community Cloud
1. share.streamlit.io → **New app** → pick the repo, branch, and
   `streamlit_app.py` as the main file.
2. **Advanced → Secrets** → paste (TOML):
   ```toml
   DATABASE_URL = "postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require"
   POLYGON_API_KEY = "your_new_polygon_key"     # Stock page: prices/financials/news
   ALPHAVANTAGE_API_KEY = "your_av_key"          # optional: concalls (else IBM-only)
   FMP_API_KEY = "your_new_fmp_key"              # optional on web (used by refresh)
   ```
   (The web app only truly needs `DATABASE_URL` + `POLYGON_API_KEY`; the rest are
   used by the refresh job in step 4.)
3. Deploy. The app boots, `APP_ENV` is unset so it detects prod via Postgres and
   hides the admin ingestion buttons automatically.
4. **Make it private** (optional, free): app → Settings → Sharing → restrict to
   your email(s). That's your auth.

## 4. Schedule the nightly refresh with GitHub Actions
The workflow `.github/workflows/refresh.yml` is already in the repo
(`cron: 30 11 * * *` = 5 PM IST). Add the repo secrets:
- GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
- Add: `DATABASE_URL`, `FMP_API_KEY`, `POLYGON_API_KEY`, `ALPHAVANTAGE_API_KEY`,
  `EODHD_API_KEY` (same values as Neon/Streamlit).
- Trigger it once: **Actions → Daily refresh → Run workflow**. Watch the log end
  with `=== done (ok) ===`. Reload the app — the sidebar "Data as of" updates.

---

## Trade-offs vs Render (~$27/mo)
- **App sleeps when idle** on Streamlit Cloud → a few-second cold start on first
  visit. Fine for personal use.
- **GitHub Actions cron is best-effort** — it can lag 5–15 min at peak, and
  scheduled workflows are auto-disabled after 60 days of no repo activity
  (a commit or a manual run re-arms it).
- **Neon free tier** auto-suspends when idle (first query wakes it, ~1s) and caps
  storage ~0.5 GB — plenty now, but prune old `daily_bars` if it ever fills.
- **Fundamentals endpoint**: Polygon's `vX/reference/financials` is flagged
  legacy but currently live; if disabled, fundamentals + the Stock page's
  financial history freeze (fix = Polygon Financials add-on or repoint to FMP).
- **No API purchase required** — everything runs on free tiers.

"""TechnoFunda Screener -- web app (Streamlit).

Reuses the same backend modules as the CLI. Reads from the SQLite DB that the
CLI / bootstrap.py populate, and can trigger light ingestion from the UI.

Performance: pages are selected in the sidebar so only ONE page computes per
run (st.tabs would run every tab's heavy compute on every interaction). Heavy
analytics are cached and keyed on a cheap data signature.

Run:
    streamlit run streamlit_app.py
"""
from __future__ import annotations

import datetime as _dt
from pathlib import Path

import pandas as pd
import streamlit as st

# Streamlit Community Cloud stores secrets in st.secrets (a TOML store), not OS
# env vars. Copy them into os.environ BEFORE importing config (which reads
# os.getenv at import time), so DATABASE_URL + API keys are picked up. On
# Render / GitHub Actions the values are already real env vars, so this no-ops.
import os as _os
try:
    for _k, _v in dict(st.secrets).items():
        if isinstance(_v, str):
            _os.environ.setdefault(_k, _v)
except Exception:
    pass

import config
from src.db import database as db

st.set_page_config(page_title="TechnoFunda Screener", page_icon="📈", layout="wide")
ROOT = Path(__file__).resolve().parent

# Production (Postgres/Render): the cron job owns all ingestion, so the in-app
# heavy-job buttons are hidden (they'd run inside the web dyno on a public URL).
PROD = db.IS_PG


# --- data status & cached loaders ----------------------------------------

def db_status() -> dict:
    with db.connect() as conn:
        def count(t):
            try:
                return conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            except Exception:
                return 0
        has_bars = count("daily_bars")
        return {
            "tickers": count("tickers"),
            "bars": has_bars,
            "bar_symbols": conn.execute("SELECT COUNT(DISTINCT symbol) FROM daily_bars").fetchone()[0] if has_bars else 0,
            "bar_dates": conn.execute("SELECT COUNT(DISTINCT date) FROM daily_bars").fetchone()[0] if has_bars else 0,
            "fundamentals": count("fundamentals"),
            "last_bar_date": conn.execute("SELECT MAX(date) FROM daily_bars").fetchone()[0] if has_bars else None,
        }


def get_meta() -> dict:
    """Read the backend refresh metadata (when the daily job last ran)."""
    with db.connect() as conn:
        try:
            row = conn.execute(
                "SELECT last_run_ist, status, regime, summary FROM refresh_meta "
                "LIMIT 1").fetchone()
            return dict(row) if row else {}
        except Exception:
            return {}


def data_sig() -> str:
    """Cheap signature that changes when the underlying data or a refresh changes."""
    s = db_status()
    meta = get_meta()
    return (f'{s["bars"]}:{s["fundamentals"]}:{s["tickers"]}:{s["last_bar_date"]}'
            f':{meta.get("last_run_ist", "")}')


@st.cache_data(ttl=600)
def load_bars(_sig: str, symbols: tuple[str, ...] | None = None) -> pd.DataFrame:
    with db.connect() as conn:
        return db.load_bars(conn, symbols=list(symbols) if symbols else None)


# SQLite has no boolean type, so bool columns round-trip as 0/1 ints. Coerce
# these back to real bools so boolean masking (df[df[col]]) works on read.
_BOOL_COLS = {
    "above_200ema", "above_50ema", "sound_not_stretched", "above_ema_long",
    "above_ema_mid", "at_52w_high", "at_52w_low", "ibd50", "rs_new_high",
    "rerating_setup", "above_ma",
}


@st.cache_data(ttl=600)
def load_table(_sig: str, name: str) -> pd.DataFrame:
    try:
        df = db.read_df(f"SELECT * FROM {name}")
    except Exception:
        return pd.DataFrame()
    for c in df.columns:
        if c in _BOOL_COLS:
            df[c] = df[c].fillna(0).astype(bool)
    return df


@st.cache_data(ttl=1800)
def get_breadth(_sig: str) -> pd.DataFrame:
    """Prefer the stored breadth table (fast); compute only if absent."""
    stored = load_table(_sig, "breadth")
    if not stored.empty:
        return stored.sort_values("date")
    from src.analysis.breadth import compute_breadth
    bars = load_bars(_sig)
    return compute_breadth(bars) if not bars.empty else pd.DataFrame()


@st.cache_data(ttl=1800)
def get_sectors(_sig: str) -> pd.DataFrame:
    # Backend snapshot first (no compute); fall back to live compute.
    snap = load_table(_sig, "sector_scores")
    if not snap.empty:
        return snap
    from src.analysis.sectors import SECTOR_ETFS, score_sector_etfs
    bars = load_bars(_sig, tuple(SECTOR_ETFS.values()))
    return score_sector_etfs(bars) if not bars.empty else pd.DataFrame()


@st.cache_data(ttl=1800)
def get_constituents(_sig: str) -> pd.DataFrame:
    snap = load_table(_sig, "stock_technicals")
    if not snap.empty:
        return snap
    from src.analysis.sectors import stock_technicals_by_sector
    from src.providers.ibd50 import ibd50_symbols
    bars = load_bars(_sig)
    tick = load_table(_sig, "tickers")
    if bars.empty or tick.empty:
        return pd.DataFrame()
    return stock_technicals_by_sector(bars, tick, ibd50=ibd50_symbols())


@st.cache_data(ttl=1800)
def get_ticker_options(_sig: str) -> list[str]:
    """'SYMBOL — Name' options for the search box, from the classified universe."""
    t = load_table(_sig, "tickers")
    if t.empty:
        return []
    t = t.sort_values("market_cap", ascending=False, na_position="last")
    syms = t["symbol"].astype(str).tolist()
    names = (t["name"].tolist() if "name" in t.columns else syms)
    out = []
    for s, n in zip(syms, names):
        out.append(f"{s} — {n}" if (isinstance(n, str) and n) else s)
    return out


@st.cache_data(ttl=3600)
def get_stock_financials(_sig: str, symbol: str) -> dict:
    from src.analysis.company import financial_history
    try:
        return financial_history(symbol)
    except Exception as e:
        return {"error": str(e)}


@st.cache_data(ttl=1800)
def get_stock_news(_sig: str, symbol: str, limit: int = 10) -> list:
    from src.providers import polygon
    try:
        return polygon.news(symbol, limit=limit)
    except Exception:
        return []


@st.cache_data(ttl=3600)
def get_stage(_sig: str, symbol: str):
    """Weinstein stage for one symbol. Uses the DB if it has enough history,
    else fetches ~1.3 years from Polygon on demand. Returns (result, series)."""
    from src.analysis.stage import classify_stage, stage_series
    df = load_bars(_sig, (symbol,))
    if len(df) < 180:
        from src.providers import polygon
        end = _dt.date.today()
        start = end - _dt.timedelta(days=480)
        try:
            res = polygon.daily_bars(symbol, start.isoformat(), end.isoformat())
            df = pd.DataFrame(polygon.to_bar_rows(res, symbol=symbol))
        except Exception as e:
            return {"stage": None, "label": f"Fetch failed: {e}",
                    "action": ""}, pd.DataFrame()
    if df.empty:
        return {"stage": None, "label": "No price data", "action": ""}, pd.DataFrame()
    return classify_stage(df), stage_series(df)


STAGE_COLOR = {1: "🔵", 2: "🟢", 3: "🟠", 4: "🔴"}


def humanize_usd(v) -> str:
    """Format a dollar amount compactly: $113.83B, $456.2M, $12,340."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    a = abs(float(v))
    sign = "-" if v < 0 else ""
    if a >= 1e9:
        return f"{sign}${a / 1e9:.2f}B"
    if a >= 1e6:
        return f"{sign}${a / 1e6:.1f}M"
    return f"{sign}${a:,.0f}"


@st.cache_data(ttl=3600)
def get_trailing_pe(_sig: str, symbols: tuple[str, ...]) -> dict:
    """Trailing P/E per symbol via FMP ratios-ttm; restricted symbols -> None."""
    from src.providers import fmp
    from src.providers.base import RestrictedError
    out: dict[str, float | None] = {}
    for s in symbols:
        try:
            data = fmp.ratios_ttm(s)
            out[s] = round(data[0].get("priceToEarningsRatioTTM"), 1) \
                if data and data[0].get("priceToEarningsRatioTTM") is not None else None
        except (RestrictedError, Exception):
            out[s] = None
    return out


@st.cache_data(ttl=1800)
def get_screen(_sig: str, industries: tuple[str, ...], min_growth: float,
               max_de: float) -> pd.DataFrame:
    from src.analysis.screener import screen
    bars = load_bars(_sig)
    fund = load_table(_sig, "fundamentals")
    tick = load_table(_sig, "tickers")
    if bars.empty or fund.empty:
        return pd.DataFrame()
    spy = load_bars(_sig, ("SPY",))   # S&P 500 proxy for the RS line
    return screen(bars, fund, tick, industries=list(industries) or None,
                  min_rev_growth=min_growth, max_debt_to_equity=max_de,
                  benchmark_bars=spy if not spy.empty else None)


@st.cache_data(ttl=1800)
def get_rerating(_sig: str) -> pd.DataFrame:
    snap = load_table(_sig, "rerating_scores")
    if not snap.empty:
        return snap
    from src.analysis.rerating import rerating_scorecard
    fund = load_table(_sig, "fundamentals")
    tick = load_table(_sig, "tickers")
    return rerating_scorecard(fund, tick) if not fund.empty else pd.DataFrame()


@st.cache_data(ttl=1800)
def get_screen_snapshot(_sig: str) -> pd.DataFrame:
    """Backend-computed default screen (growth≥15 + RS + stage). No API/compute."""
    return load_table(_sig, "screen_results")


@st.cache_data(ttl=1800)
def get_earnings_snapshot(_sig: str) -> pd.DataFrame:
    """Backend-computed earnings calendar (name + consensus + trailing P/E)."""
    return load_table(_sig, "earnings_enriched")


@st.cache_data(ttl=86400)
def resolve_names_cached(_sig: str, symbols: tuple[str, ...]) -> dict:
    from src.providers.sec import resolve_names
    return resolve_names(symbols)


@st.cache_data(ttl=3600)
def fetch_earnings(from_date: str, to_date: str) -> pd.DataFrame:
    from src.providers import fmp
    try:
        return pd.DataFrame(fmp.earnings_calendar(from_date, to_date))
    except Exception as e:
        st.warning(f"Earnings fetch failed: {e}")
        return pd.DataFrame()


REGIME_HELP = {
    "aggressive": ("🟢", "Broad participation — size up (full/aggressive positions)."),
    "moderate": ("🟡", "Mixed tape — normal position size."),
    "shallow": ("🔴", "Weak breadth — defensive: small size or cash."),
}


# --- sidebar --------------------------------------------------------------

st.sidebar.title("📈 TechnoFunda")
PAGES = ["Stock", "Market Regime", "Sectors", "Screener", "Re-rating",
         "Earnings Calendar", "Concall", "Data"]
page = st.sidebar.radio("Go to", PAGES, label_visibility="collapsed")

status = db_status()
sig = data_sig()
meta = get_meta()
st.sidebar.divider()
if meta.get("last_run_ist"):
    badge = {"ok": "🟢", "partial": "🟡"}.get(meta.get("status"), "⚪")
    st.sidebar.caption(f'{badge} Data as of **{meta["last_run_ist"]}**')
else:
    st.sidebar.caption("⚪ No backend refresh yet — run it in the Data tab.")
st.sidebar.caption("Local data status")
st.sidebar.metric("Tickers", status["tickers"])
st.sidebar.metric("Price bars", f'{status["bars"]:,}',
                  help=f'{status["bar_symbols"]} symbols · {status["bar_dates"]} days')
st.sidebar.metric("Fundamentals", status["fundamentals"])
st.sidebar.caption(f'Latest bar: {status["last_bar_date"] or "—"}')
st.sidebar.write("**Keys:** " + ("✅FMP " if config.FMP_API_KEY else "❌FMP ") +
                 ("✅Polygon" if config.POLYGON_API_KEY else "❌Polygon"))
if status["bars"] == 0:
    st.sidebar.info("No price data yet. Run `python bootstrap.py` or use **Data**.")
enough_hist = status["bar_dates"] >= 200 and status["bar_symbols"] >= 50


# --- pages ----------------------------------------------------------------

if page == "Stock":
    st.header("🔎 Stock")
    opts = get_ticker_options(sig)
    c1, c2 = st.columns([3, 1])
    choice = c1.selectbox("Search a stock (type to filter)", [""] + opts,
                          help="Universe of classified names. Or type any symbol on the right.")
    typed = c2.text_input("…or any symbol", "").strip().upper()
    symbol = typed or (choice.split(" — ")[0] if choice else "")

    if not symbol:
        st.info("Search for a stock above to see price, stage, financials, "
                "concall summary, and news.")
    else:
        tickers = load_table(sig, "tickers")
        trow = tickers[tickers["symbol"] == symbol]
        name = trow.iloc[0]["name"] if not trow.empty else symbol
        sector = trow.iloc[0]["sector"] if not trow.empty else None
        mcap = trow.iloc[0]["market_cap"] if not trow.empty else None
        bars = load_bars(sig, (symbol,))

        st.subheader(f"{symbol} — {name}")
        # --- header metrics: price, regime, stage --------------------------
        price = float(bars["close"].iloc[-1]) if not bars.empty else None
        chg = (100 * (bars["close"].iloc[-1] / bars["close"].iloc[-2] - 1)
               if len(bars) > 1 else None)
        res, series = get_stage(sig, symbol)
        stg = res.get("stage")
        regime = (get_meta().get("regime") or "—")
        m = st.columns(5)
        m[0].metric("Price", f"${price:,.2f}" if price else "—",
                    f"{chg:+.2f}%" if chg is not None else None)
        m[1].metric("Market cap", f"${mcap/1e9:,.1f}B" if pd.notna(mcap) else "—")
        m[2].metric("Sector", sector or "—")
        m[3].metric("Stage", f"{STAGE_COLOR.get(stg, '')} {int(stg)}" if stg else "—",
                    help=res.get("label"))
        m[4].metric("Market regime", f"{REGIME_HELP.get(regime, ('',''))[0]} {regime}",
                    help="Overall market posture for position sizing.")

        # --- price chart ---------------------------------------------------
        if not bars.empty:
            ch = bars.copy()
            ch["date"] = pd.to_datetime(ch["date"])
            ch = ch.set_index("date")
            if not series.empty and "ma150" in series:
                ch = ch.join(series["ma150"])
                st.line_chart(ch[["close", "ma150"]])
            else:
                st.line_chart(ch["close"])

        # --- financial history --------------------------------------------
        st.subheader("Financial history")
        fin = get_stock_financials(sig, symbol)
        if fin.get("error") or (fin.get("annual", pd.DataFrame()).empty):
            st.info("No financials available (Polygon covers SEC filers).")
        else:
            from src.analysis.company import latest_growth
            hy = latest_growth(fin)
            g = st.columns(3)
            g[0].metric("Revenue growth (YoY)",
                        f"{hy.get('revenue_growth')}%" if hy.get("revenue_growth") is not None else "—")
            g[1].metric("Earnings growth ex-extraordinary",
                        f"{hy.get('eps_growth_ex_extra')}%" if hy.get("eps_growth_ex_extra") is not None else "—",
                        help="From continuing-operations earnings (split-immune).")
            g[2].metric("Latest period", hy.get("period", "—"))
            atab, qtab = st.tabs(["Annual", "Quarterly"])
            cols = ["period", "revenue", "net_income", "eps_reported",
                    "revenue_growth", "eps_growth_ex_extra"]
            fmt = {"revenue": st.column_config.TextColumn("Revenue"),
                   "net_income": st.column_config.TextColumn("Net income"),
                   "eps_reported": st.column_config.NumberColumn("EPS (reported)", format="$%.2f"),
                   "revenue_growth": st.column_config.NumberColumn("Rev growth", format="%.1f%%"),
                   "eps_growth_ex_extra": st.column_config.NumberColumn("Earnings growth", format="%.1f%%")}
            for tab, key in [(atab, "annual"), (qtab, "quarterly")]:
                df = fin.get(key, pd.DataFrame())
                if not df.empty:
                    disp = df[[c for c in cols if c in df]].iloc[::-1].copy()
                    for mcol in ("revenue", "net_income"):
                        if mcol in disp:
                            disp[mcol] = disp[mcol].map(humanize_usd)
                    tab.dataframe(disp, use_container_width=True, hide_index=True,
                                  column_config=fmt)
            st.caption("EPS shown as-reported (not split-adjusted); the growth "
                       "metric uses continuing-operations earnings, so it's "
                       "split-immune and excludes extraordinary items.")

        # --- concall summary ----------------------------------------------
        st.subheader("Concall summary")
        if st.button("Load latest concall digest"):
            from src.ingest.calendar import ingest_transcript
            from src.analysis.concall import format_digest, summarise_transcript
            q = fin.get("quarterly", pd.DataFrame())
            yr, qtr = _dt.date.today().year, 1
            if not q.empty:
                per = str(q.iloc[-1]["period"])  # e.g. 'Q2 2026'
                try:
                    qtr = int(per.split()[0].replace("Q", "")); yr = int(per.split()[1])
                except Exception:
                    pass
            with st.spinner(f"Fetching {symbol} {yr}Q{qtr} transcript..."):
                n = ingest_transcript(symbol, yr, qtr)
            if n:
                with db.connect() as conn:
                    row = conn.execute("SELECT content FROM transcripts WHERE symbol=? AND period=?",
                                       (symbol, f"{yr}-Q{qtr}")).fetchone()
                st.markdown(format_digest(symbol, f"{yr}-Q{qtr}",
                                          summarise_transcript(row["content"])))
            else:
                st.info("Transcript unavailable — Alpha Vantage's free demo key only "
                        "serves IBM. Add ALPHAVANTAGE_API_KEY to .env for any ticker "
                        "(see the Concall page).")

        # --- latest news ---------------------------------------------------
        st.subheader("Latest news")
        news = get_stock_news(sig, symbol, 10)
        if not news:
            st.info("No recent news.")
        for a in news[:10]:
            pub = (a.get("published_utc") or "")[:10]
            src = a.get("publisher", {}).get("name", "")
            st.markdown(f"**[{a.get('title','(untitled)')}]({a.get('article_url','')})**  "
                        f"<br><span style='color:gray;font-size:0.85em'>{pub} · {src}</span>",
                        unsafe_allow_html=True)

elif page == "Market Regime":
    st.header("Market Regime & Breadth")
    st.caption("Position-sizing posture from the % of the universe above its 200EMA.")
    breadth = get_breadth(sig)
    if breadth.empty:
        st.info("No breadth data yet. Ingest prices, then run breadth "
                "(`python -m src.cli breadth`) or use bootstrap.py.")
    else:
        from src.analysis.breadth import latest_regime
        latest = latest_regime(breadth)
        regime = latest.get("regime") or "n/a"
        icon, help_txt = REGIME_HELP.get(regime, ("⚪", ""))
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Regime", f"{icon} {regime}")
        c2.metric("% above 200EMA", latest.get("pct_above_200ema"))
        c3.metric("New 52w highs", int(latest.get("new_52w_highs") or 0))
        c4.metric("Universe", int(latest.get("universe_size") or 0))
        st.caption(help_txt)
        if not enough_hist:
            st.warning("⚠️ Only "
                       f'{status["bar_dates"]} trading days ingested — a real '
                       "200EMA/52-week read needs ~200+. These numbers are "
                       "structural, not yet a tradable signal. Run the full "
                       "`python bootstrap.py` backfill.")
        b = breadth.copy()
        b["date"] = pd.to_datetime(b["date"])
        b = b.set_index("date")

        st.subheader("% of universe above 200/50 EMA")
        pcols = [c for c in ["pct_above_200ema", "pct_above_50ema"] if c in b]
        st.line_chart(b[pcols])

        st.subheader("New 52-week highs vs lows (trend)")
        if "new_52w_highs" in b:
            hl = b[[c for c in ["new_52w_highs", "new_52w_lows"] if c in b]]
            st.line_chart(hl)
            if "new_52w_lows" in b:
                st.caption("Net new highs (highs − lows) — expansion vs contraction:")
                net = (b["new_52w_highs"] - b["new_52w_lows"]).rename("net_new_highs")
                st.bar_chart(net)
            if int(b["new_52w_highs"].sum()) == 0 and not enough_hist:
                st.info("52-week-high counts are 0 until ~252 trading days are "
                        "ingested (the 52w window). The full backfill populates this.")

        with st.expander("Raw breadth table"):
            st.dataframe(breadth.tail(60), use_container_width=True)

elif page == "Sectors":
    st.header("Sector TechnoFunda")
    st.caption("Sector ETFs ranked by RSI (strongest momentum first). "
               "Click a sector to expand its constituent stocks.")
    sc = get_sectors(sig)
    if sc.empty:
        st.info("No sector ETF bars yet. Backfill XLK, XLF, ... via bootstrap/Data.")
    else:
        st.dataframe(sc, use_container_width=True)
        if "sound_not_stretched" in sc:
            sound = sc[sc["sound_not_stretched"]]
            if not sound.empty:
                st.success("Sound & not stretched: " +
                           ", ".join(str(r.sector or r.etf) for r in sound.itertuples()))

        st.subheader("Stocks by sector")
        cons = get_constituents(sig)
        if cons.empty:
            st.info("No classified universe yet — ingest the universe (Data tab).")
        else:
            ibd_n = int(cons["ibd50"].sum()) if "ibd50" in cons else 0
            if ibd_n:
                st.caption(f"⭐ = in the IBD 50 ({ibd_n} tagged in your universe).")
            else:
                st.caption("IBD 50 tags: none loaded yet — add data/ibd50.json "
                           "(see Data tab) to light up ⭐ tags.")
            # Order sector expanders to match the ETF RSI ranking above.
            etf_order = [s for s in sc["sector"].tolist() if pd.notna(s)]
            present = [s for s in etf_order if s in set(cons["sector"].dropna())]
            present += [s for s in sorted(cons["sector"].dropna().unique())
                        if s not in present]
            for sector in present:
                grp = cons[cons["sector"] == sector].copy()
                star = "⭐" if ("ibd50" in grp and grp["ibd50"].any()) else ""
                with st.expander(f"{sector} · {len(grp)} stocks {star}"):
                    if "ibd50" in grp:
                        grp = grp.copy()
                        grp.insert(0, "★", grp["ibd50"].map({True: "⭐", False: ""}))
                        grp = grp.drop(columns=["ibd50"])
                    st.dataframe(grp, use_container_width=True, hide_index=True)

elif page == "Screener":
    st.header("Stock Screener")
    st.caption("Backend-computed daily (growth ≥15% + trend + balance sheet + RS "
               "+ stage). Filters below run in-memory — no API calls on load.")
    base = get_screen_snapshot(sig)
    if base.empty:
        st.info("No screen snapshot yet. Run the backend refresh in the **Data** "
                "tab (or wait for the 5 PM IST job).")
    else:
        inds = sorted(base["industry"].dropna().unique()) if "industry" in base else []
        c1, c2 = st.columns(2)
        pick = c1.multiselect("Industries (blank = all sectors)", inds)
        rs_only = c2.checkbox("RS line at new high only", value=True,
                              help="Relative-strength line (stock ÷ S&P 500) at a "
                                   "new high — a leadership signal.")
        out = base.copy()
        if pick:
            out = out[out["industry"].isin(pick)]
        if "rs_new_high" in out and rs_only:
            out = out[out["rs_new_high"] == True]  # noqa: E712
        if "stage" in out:
            pick_stages = st.multiselect(
                "Filter by stage", [1, 2, 3, 4], default=[2],
                format_func=lambda n: f"{STAGE_COLOR[n]} Stage {n}")
            if pick_stages:
                out = out[out["stage"].isin(pick_stages)]
            out = out.copy()
            out["stage"] = out["stage"].map(
                lambda n: f"{STAGE_COLOR.get(n, '')} {int(n)}" if pd.notna(n) else "")

        st.write(f"**{len(out)} candidates** "
                 "(default: growth ≥15%, RS line at new high, Stage 2, all sectors)")
        st.caption("RS-new-high adds +10 to score. rs_line = stock ÷ SPY.")
        st.dataframe(out, use_container_width=True, hide_index=True)

    with st.expander("Advanced — custom screen (recompute from DB, still no API)"):
        c1, c2 = st.columns(2)
        g = c1.number_input("Min revenue YoY %", value=15.0, step=5.0, key="adv_g")
        de = c2.number_input("Max debt/equity", value=1.0, step=0.25, key="adv_de")
        custom = get_screen(sig, tuple(), g, de)
        st.write(f"**{len(custom)} candidates** at growth ≥{g:.0f}%, D/E ≤{de}")
        st.dataframe(custom, use_container_width=True, hide_index=True)

elif page == "Re-rating":
    st.header("Re-rating Scorecard")
    st.caption("Cheap vs own history + not expensive vs peers + growth accelerating.")
    sc = get_rerating(sig)
    if sc.empty:
        st.info("Need fundamentals ingested first (annual, free-tier symbols).")
    else:
        if st.checkbox("Only flagged setups", value=False):
            sc = sc[sc["rerating_setup"]]
        st.dataframe(sc, use_container_width=True)

elif page == "Earnings Calendar":
    st.header("Earnings Calendar")
    st.caption("Backend-computed daily — names, consensus EPS, revenue ($B) and "
               "trailing P/E are pre-fetched. No API calls on load.")
    full = get_earnings_snapshot(sig)
    if full.empty:
        st.info("No earnings snapshot yet. Run the backend refresh in the **Data** "
                "tab (or wait for the 5 PM IST job).")
    else:
        wl_path = ROOT / "watchlist.txt"
        wl = {l.strip().upper() for l in wl_path.read_text().splitlines()
              if l.strip() and not l.startswith("#")} if wl_path.exists() else set()
        # Optional date-range filter over the pre-fetched window (in-memory only).
        full = full.copy()
        full["date"] = full["date"].astype(str)
        dmin, dmax = full["date"].min(), full["date"].max()
        c1, c2 = st.columns(2)
        frm = c1.text_input("From (YYYY-MM-DD)", dmin)
        to = c2.text_input("To (YYYY-MM-DD)", dmax)
        df = full[(full["date"] >= frm) & (full["date"] <= to)].sort_values("date")
        names = dict(zip(df["symbol"], df.get("name", pd.Series(dtype=str))))

        # Units: EPS in dollars, revenue in $ billions, P/E as a ratio.
        colcfg = {
            "eps_consensus": st.column_config.NumberColumn("EPS consensus", format="$%.2f"),
            "epsActual": st.column_config.NumberColumn("EPS actual", format="$%.2f"),
            "trailing_pe": st.column_config.NumberColumn("Trailing P/E", format="%.1f"),
            "rev_consensus": st.column_config.NumberColumn("Rev consensus", format="$%.2fB"),
            "revenueActual": st.column_config.NumberColumn("Rev actual", format="$%.2fB"),
        }
        st.caption("EPS in $/share, revenue in $ billions. Consensus = analyst "
                   "estimate (FMP); trailing P/E from ratios-ttm.")
        if wl:
            st.subheader("On your watchlist")
            hit = df[df["symbol"].str.upper().isin(wl)]
            st.dataframe(hit if not hit.empty else
                         pd.DataFrame({"info": ["none reporting this window"]}),
                         use_container_width=True, hide_index=True, column_config=colcfg)
        st.subheader(f"All events ({len(df)})")
        st.dataframe(df, use_container_width=True, hide_index=True, column_config=colcfg)

        # --- Weinstein stage analysis for a chosen company ----------------
        st.divider()
        st.subheader("Technical analysis — Weinstein stage (1·2·3·4)")
        st.caption("Pick a company reporting to see its stage: 🔵 1 basing · "
                   "🟢 2 advancing · 🟠 3 topping · 🔴 4 declining. "
                   "Uses the 30-week (150-day) MA and its slope.")
        pick_sym = st.selectbox("Company", list(df["symbol"]))
        if pick_sym:
            with st.spinner(f"Analysing {pick_sym} (≈1yr of daily bars)..."):
                res, series = get_stage(sig, pick_sym)
            if res.get("stage") is None:
                st.info(res.get("label", "No stage available."))
            else:
                stg = res["stage"]
                nm = names.get(pick_sym, "")
                st.markdown(f"### {STAGE_COLOR[stg]} {res['label']}  "
                            f"<span style='font-size:0.6em'>· {pick_sym} {nm}</span>",
                            unsafe_allow_html=True)
                st.caption(res["action"])
                m = st.columns(6)
                m[0].metric("Close", res["close"])
                m[1].metric("150-day MA", res["ma150"])
                m[2].metric("Price vs MA", "above" if res["above_ma"] else "below")
                m[3].metric("MA slope (1mo)", f'{res["ma_slope_pct"]}%')
                m[4].metric("52w range pos", f'{res["range_pos"]}%')
                m[5].metric("RSI(14)", res["rsi14"])
                if not series.empty:
                    st.line_chart(series)

elif page == "Concall":
    st.header("Concall Summariser")
    from src.analysis.concall import (format_digest, summarise_transcript,
                                      summarise_with_claude)
    av_ready = bool(config.ALPHAVANTAGE_API_KEY)
    st.caption("Fetch an earnings-call transcript (free via Alpha Vantage) or "
               "paste one → guidance / risks / drivers digest.")

    use_llm = st.checkbox("Use Claude for the summary (needs ANTHROPIC_API_KEY)",
                          value=False)

    def render(sym, period, text):
        if use_llm:
            try:
                st.markdown(summarise_with_claude(text)); return
            except RuntimeError as e:
                st.warning(f"LLM unavailable ({e}); showing heuristic digest.")
        s = summarise_transcript(text)
        st.markdown(format_digest(sym, period, s))
        st.caption(f"Tone tilt: {s['tone']['tilt']} "
                   f"(+{s['tone']['positive']}/-{s['tone']['cautious']})")

    fetch_tab, paste_tab, stored_tab = st.tabs(["Fetch", "Paste", "Stored"])

    with fetch_tab:
        if not av_ready:
            st.info("No `ALPHAVANTAGE_API_KEY` set — the free **demo key only "
                    "works for IBM**. Get a free key (email only) at "
                    "alphavantage.co/support/#api-key and add it to `.env` for "
                    "any other ticker. 25 fetches/day on the free tier.")
        c1, c2, c3 = st.columns(3)
        fsym = c1.text_input("Symbol", "IBM" if not av_ready else "AAPL")
        fyear = c2.number_input("Year", 2010, 2030, 2024)
        fq = c3.number_input("Quarter", 1, 4, 1)
        if st.button("Fetch & summarise concall"):
            from src.ingest.calendar import ingest_transcript
            with st.spinner(f"Fetching {fsym} {fyear}Q{fq} from Alpha Vantage..."):
                n = ingest_transcript(fsym, int(fyear), int(fq))
            if n:
                with db.connect() as conn:
                    row = conn.execute(
                        "SELECT content FROM transcripts WHERE symbol=? AND period=?",
                        (fsym.upper(), f"{fyear}-Q{fq}")).fetchone()
                st.success(f"Fetched {len(row['content']):,} chars.")
                st.cache_data.clear()
                render(fsym.upper(), f"{fyear}-Q{fq}", row["content"])
            else:
                st.error("Fetch failed — see the note above (demo key = IBM only, "
                         "or the quarter may not exist / daily limit hit).")

    with paste_tab:
        sym = st.text_input("Symbol (label only)", "DEMO", key="paste_sym")
        txt = st.text_area("Transcript text", height=220,
                           placeholder="Paste the concall transcript here...")
        if st.button("Summarise pasted text") and txt.strip():
            render(sym, "", txt)

    with stored_tab:
        stored = load_table(sig, "transcripts")
        if stored.empty:
            st.info("No transcripts stored yet. Fetch one in the Fetch tab.")
        else:
            opts = (stored["symbol"] + " " + stored["period"]).tolist()
            choice = st.selectbox("Stored transcripts", opts)
            if choice:
                s_sym, s_per = choice.split(" ", 1)
                row = stored[(stored["symbol"] == s_sym) &
                             (stored["period"] == s_per)].iloc[0]
                render(s_sym, s_per, row["content"])

elif page == "Data":
    st.header("Data & Ingestion")

    st.subheader("Backend daily refresh")
    if meta:
        badge = {"ok": "🟢", "partial": "🟡"}.get(meta.get("status"), "⚪")
        st.write(f'{badge} Last run: **{meta.get("last_run_ist", "—")}** · '
                 f'status {meta.get("status")} · regime {meta.get("regime")}')
        if meta.get("summary"):
            st.caption(meta["summary"])
    if PROD:
        st.caption("In production the **cron job** (5 PM IST) owns all ingestion; "
                   "manual heavy-job buttons are disabled here for safety.")
    else:
        st.caption("The 5 PM refresh pre-computes every page into snapshot tables "
                   "so pages make no API calls. Trigger it manually (dev only):")
        if st.button("↻ Run backend refresh now (background)"):
            import subprocess
            import sys
            subprocess.Popen([sys.executable, str(ROOT / "daily_refresh.py")],
                             cwd=str(ROOT),
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            st.success("Refresh started in the background (~2–3 min). Reload in a "
                       "few minutes to see fresh data.")
        st.divider()
        st.subheader("Universe + fundamentals (full US, Polygon)")
        st.caption(f"Current universe: **{status['tickers']} tickers**, "
                   f"{status['fundamentals']} fundamental rows.")
        if st.button("↻ Rebuild full universe (background, ~30 min)"):
            import subprocess
            import sys
            subprocess.Popen([sys.executable, "-c",
                              "from src.ingest.fundamentals_polygon import rebuild_universe; "
                              "rebuild_universe(min_market_cap=1e9, years=2, throttle=13)"],
                             cwd=str(ROOT),
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            st.success("Universe rebuild started in the background (~30 min).")

    if PROD:
        st.stop()   # hide the remaining dev ingestion controls in production

    st.subheader("Price bars — one day (whole market, for breadth)")
    d = st.date_input("Trade date", _dt.date(2026, 7, 17), key="grouped_day")
    if st.button("Ingest that day's bars"):
        from src.ingest.prices import ingest_grouped_day
        with st.spinner("Fetching grouped daily bars..."):
            n = ingest_grouped_day(d.isoformat())
        st.success(f"{n} bars ingested"); st.cache_data.clear()

    st.subheader("IBD 50 list (for ⭐ tags on the Sectors page)")
    from src.providers.ibd50 import (as_of as ibd_asof, ibd50_symbols,
                                     refresh as ibd_refresh, save as ibd_save)
    cur = ibd50_symbols()
    st.caption(f"Currently loaded: {len(cur)} symbols"
               + (f" (as of {ibd_asof()})" if ibd_asof() else " — none yet"))
    st.write("No free official IBD API exists (IBD is paywalled). This pulls the "
             "**FFTY ETF** holdings — a free proxy that tracks the IBD 50 Index "
             "(~50 names, rebalanced weekly; close but not the exact editorial list).")
    if st.button("↻ Fetch IBD 50 from FFTY (free, no key)"):
        with st.spinner("Fetching FFTY holdings..."):
            try:
                n = ibd_refresh()
                st.success(f"Loaded {n} IBD 50 (FFTY) symbols."); st.cache_data.clear()
            except Exception as e:
                st.error(f"Fetch failed: {e}")
    with st.expander("…or paste the list manually"):
        ibd_text = st.text_area("IBD 50 tickers (space/comma/newline separated)",
                                value=" ".join(sorted(cur)), height=90)
        ibd_date = st.text_input("As-of date", value=str(_dt.date.today()))
        if st.button("Save pasted IBD 50 list"):
            import re
            syms = [t for t in re.split(r"[\s,]+", ibd_text) if t.strip()]
            n = ibd_save(syms, ibd_date)
            st.success(f"Saved {n} IBD 50 symbols."); st.cache_data.clear()

    st.subheader("Recompute breadth from stored bars")
    if st.button("Recompute breadth"):
        from src.analysis.breadth import compute_breadth
        with st.spinner("Computing breadth across the universe..."):
            bars = load_bars(data_sig())
            out = compute_breadth(bars)
            with db.connect() as conn:
                db.upsert(conn, "breadth", out.to_dict("records"))
        st.success(f"Breadth computed for {len(out)} dates"); st.cache_data.clear()

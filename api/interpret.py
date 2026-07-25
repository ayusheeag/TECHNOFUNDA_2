"""Plain-English interpretation builders — the API generates the sentences the
web renders (mirrors the web's mock interpret layer). Every list row / metric
gets an Interpretation {headline, detail, tone} so there are no naked numbers."""
from __future__ import annotations

STAGE_SHORT = {
    1: "Stage 1 — basing",
    2: "Stage 2 — advancing uptrend",
    3: "Stage 3 — topping",
    4: "Stage 4 — declining downtrend",
}
STAGE_LABEL = {
    1: "Stage 1 — Basing / accumulation",
    2: "Stage 2 — Advancing / uptrend",
    3: "Stage 3 — Topping / distribution",
    4: "Stage 4 — Declining / downtrend",
}
STAGE_ACTION = {
    1: "Watchlist — wait for a Stage 2 breakout.",
    2: "Uptrend — the ownable stage.",
    3: "Distribution — tighten stops / take profits.",
    4: "Downtrend — avoid / stay away.",
}
STAGE_TONE = {1: "neutral", 2: "good", 3: "warn", 4: "bad"}

REGIME_META = {
    "aggressive": {"glyph": "🟢", "sizing": "Broad participation — full position sizes reasonable."},
    "moderate": {"glyph": "🟡", "sizing": "Mixed tape — normal position size."},
    "shallow": {"glyph": "🔴", "sizing": "Weak breadth — defensive: small size or cash."},
}


def interp(headline: str, tone: str = "neutral", detail: str | None = None) -> dict:
    return {"headline": headline, "tone": tone, "detail": detail}


def pct_txt(x, digits=0) -> str:
    if x is None:
        return "n/a"
    return f"{'+' if x >= 0 else '−'}{abs(x):.{digits}f}%"


def regime_interp(regime: str | None, pct200, new_highs) -> dict:
    if not regime:
        return interp("Regime unavailable — thin data", "neutral", "No posture inferred.")
    meta = REGIME_META[regime]
    tone = "good" if regime == "aggressive" else "bad" if regime == "shallow" else "neutral"
    return interp(
        f"{regime.capitalize()} regime — {meta['sizing'].split(' — ')[-1]}",
        tone,
        f"{pct200:.0f}% of the universe is above its 200-day and {new_highs} sit at new highs — {meta['sizing'].lower()}",
    )


def sector_interp(sector: str, etf: str, chip: str, rsi) -> dict:
    rsi_txt = "—" if rsi is None else f"{round(rsi)}"
    if chip == "sound":
        return interp(f"{sector} — sound uptrend", "good", f"{etf} above its 200-day, RSI {rsi_txt} — healthy, not stretched.")
    if chip == "stretched":
        return interp(f"{sector} — extended, overbought", "warn", f"{etf} in an uptrend but RSI {rsi_txt} is overbought — wait for a pullback.")
    return interp(f"{sector} — below trend", "bad", f"{etf} below its 200-day — avoid new longs in this sector.")


def sector_chip(above200: bool, rsi) -> str:
    if not above200:
        return "below-trend"
    if rsi is not None and rsi >= 70:
        return "stretched"
    return "sound"


def screen_row_interp(verdict: str, stage, rev_yoy, rs_new_high, composite_detail) -> dict:
    word = {"act": "Act", "watch": "Watch", "avoid": "Avoid"}[verdict]
    tone = {"act": "good", "watch": "warn", "avoid": "bad"}[verdict]
    stage_txt = {2: "Stage 2 uptrend", 4: "Stage 4 downtrend", 3: "Stage 3 topping", 1: "Stage 1 base"}.get(stage, "no stage")
    rev = pct_txt(rev_yoy)
    return interp(f"{word} — {stage_txt}, revenue {rev}{', RS leading' if rs_new_high else ''}", tone, composite_detail)


def financials_interp(rev_yoy, eps_yoy) -> dict:
    tone = "good" if (rev_yoy or 0) >= 15 else "bad" if (rev_yoy or 0) < 0 else "neutral"
    return interp(
        f"Revenue {pct_txt(rev_yoy)} YoY, EPS {pct_txt(eps_yoy)} (latest reported year)",
        tone,
        "EPS growth is based on continuing operations (split-immune); n/a when the prior base was zero or negative.",
    )


def earnings_interp(days_until: int, time: str, eps_est) -> dict:
    when = "today" if days_until == 0 else "tomorrow" if days_until == 1 else f"in {days_until} days"
    time_txt = "before the open" if time == "bmo" else "after the close" if time == "amc" else "(time TBD)"
    est = "" if eps_est is None else f"Consensus EPS ${eps_est:.2f}. "
    soon = days_until <= 5
    return interp(
        f"Reports {when} {time_txt}",
        "warn" if soon else "neutral",
        f"{est}{'Close — expect a volatility event; watch guidance.' if soon else 'On the calendar; no action needed yet.'}",
    )


def rerating_interp(flagged: bool, pe_pctile, pe_vs_sector, rev_now, slope) -> dict:
    if pe_pctile is None:
        return interp("Not enough valuation history", "neutral", "Fewer than 4 P/E points.")
    if flagged:
        head = "Re-rating setup — cheap vs its own range while growth accelerates"
        tone = "good"
    else:
        head = f"No re-rating edge — {'richly valued' if pe_pctile >= 60 else 'growth not confirming'}"
        tone = "neutral"
    vs = "" if pe_vs_sector is None else f", {pct_txt(pe_vs_sector)} vs sector"
    grow = "growing" if (rev_now or 0) >= 0 else "shrinking"
    acc = "accelerating" if (slope or 0) > 0 else "decelerating" if (slope or 0) < 0 else "flat"
    return interp(head, tone, f"P/E in the {round(pe_pctile)}th percentile of its range{vs}; revenue {grow} and {acc}.")

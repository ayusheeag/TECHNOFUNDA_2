"""TechnoFunda composite score — Python mirror of the web's composite.ts, fed
from stored technicals + fundamentals + ownership (IBD50) + valuation
(re-rating). Provisional legs count at full weight; only null legs drop and the
rest renormalise."""
from __future__ import annotations

from .interpret import STAGE_SHORT, STAGE_TONE, interp

FLAT_PCT = 1.5
WEIGHTS = {"technical": 0.40, "growth": 0.30, "ownership": 0.15, "valuation": 0.15}


def _clamp(x: float) -> float:
    return max(0.0, min(100.0, x))


def _sub(value, provisional, interpretation) -> dict:
    return {"value": (None if value is None else round(value)), "provisional": provisional, "interpretation": interpretation}


def technical_leg(stage, range_pos, rs_new_high, above_ma, slope_pct) -> dict:
    if stage is None:
        return _sub(None, False, interp("No technical read", "neutral", "Needs 170 sessions of history."))
    base = {1: 45, 2: 75, 3: 35, 4: 12}[stage]
    proximity = 0.15 * ((range_pos if range_pos is not None else 50) - 50)
    rs_bonus = 12 if rs_new_high else 0
    trend_bonus = 6 if above_ma else 0
    slope_nudge = 0 if slope_pct is None else (4 if slope_pct > FLAT_PCT else -4 if slope_pct < -FLAT_PCT else 0)
    val = _clamp(base + proximity + rs_bonus + trend_bonus + slope_nudge)
    rp = range_pos if range_pos is not None else 50
    range_word = "near the top of its 52-week range" if rp >= 66 else "near the low of its range" if rp <= 33 else "mid-range"
    rs_word = "RS at a new high (leading)" if rs_new_high else "RS not yet leading"
    return _sub(val, False, interp(STAGE_SHORT[stage], STAGE_TONE[stage], f"{range_word}; {rs_word}."))


def growth_leg(rev_yoy, eps_yoy) -> dict:
    if rev_yoy is None and eps_yoy is None:
        return _sub(None, True, interp("Growth history unavailable", "neutral", "Not enough reported periods."))
    parts = []
    if rev_yoy is not None:
        parts.append(_clamp(50 + 1.4 * rev_yoy))
    if eps_yoy is not None:
        parts.append(_clamp(50 + 1.0 * eps_yoy))
    base = sum(parts) / len(parts)
    if eps_yoy is not None and eps_yoy < 0:
        base -= 10
    val = _clamp(base)
    tone = "good" if val >= 62 else "bad" if val < 45 else "neutral"

    def t(x):
        return "n/a" if x is None else f"{'+' if x >= 0 else '−'}{abs(x):.0f}%"

    return _sub(val, rev_yoy is None or eps_yoy is None, interp(f"Revenue {t(rev_yoy)} YoY, EPS {t(eps_yoy)}", tone, None))


def ownership_leg(is_ibd50: bool) -> dict:
    if is_ibd50:
        return _sub(78, True, interp("In the IBD 50", "good", "Institutional sponsorship present; provisional until a real 13F feed lands."))
    return _sub(46, True, interp("Not in the IBD 50", "neutral", "Thin ownership signal; provisional until a real 13F feed lands."))


def valuation_leg(pe_pctile, pe_vs_sector) -> dict:
    if pe_pctile is None:
        return _sub(None, True, interp("Valuation history too thin", "neutral", "Fewer than 4 P/E points; provisional on the free tier."))
    cheap_self = 100 - pe_pctile
    peer_adj = max(-15.0, min(15.0, -0.3 * (pe_vs_sector or 0)))
    val = _clamp(cheap_self * 0.7 + 50 * 0.3 + peer_adj)
    tone = "good" if pe_pctile <= 40 else "warn" if pe_pctile >= 75 else "neutral"
    room = "re-rating room" if pe_pctile <= 40 else "priced for growth" if pe_pctile >= 75 else "fairly valued vs its own range"
    vs = "" if pe_vs_sector is None else f" {'+' if pe_vs_sector >= 0 else '−'}{abs(round(pe_vs_sector))}% vs sector;"
    return _sub(val, True, interp(f"P/E in the {round(pe_pctile)}th percentile of its own range;{vs} {room}", tone, "Per-name valuation is sparse on the free tier — provisional."))


_LEG_LABEL = {"technical": "technicals", "growth": "the growth line", "ownership": "ownership", "valuation": "valuation"}


def build_composite(*, stage, range_pos, rs_new_high, above_ma, slope_pct, rev_yoy, eps_yoy, is_ibd50, pe_pctile, pe_vs_sector) -> dict:
    legs = {
        "technical": technical_leg(stage, range_pos, rs_new_high, above_ma, slope_pct),
        "growth": growth_leg(rev_yoy, eps_yoy),
        "ownership": ownership_leg(is_ibd50),
        "valuation": valuation_leg(pe_pctile, pe_vs_sector),
    }
    wsum = acc = 0.0
    for k, w in WEIGHTS.items():
        v = legs[k]["value"]
        if v is not None:
            wsum += w
            acc += w * v
    headline = round(acc / wsum) if wsum > 0 else 0
    t = legs["technical"]["value"] or 0
    if stage == 4 or t < 35 or headline < 45:
        verdict = "avoid"
    elif headline >= 68 and t >= 55 and stage == 2:
        verdict = "act"
    else:
        verdict = "watch"
    return {**legs, "headline": headline, "verdict": verdict, "interpretation": _verdict_sentence(verdict, legs, stage)}


def _verdict_sentence(verdict, legs, stage) -> dict:
    scored = [k for k in WEIGHTS if legs[k]["value"] is not None]
    dominant = max(scored, key=lambda k: legs[k]["value"] * WEIGHTS[k]) if scored else None
    drag = min(scored, key=lambda k: legs[k]["value"]) if scored else None
    tone = {"act": "good", "avoid": "bad", "watch": "warn"}[verdict]
    word = {"act": "Act", "avoid": "Avoid", "watch": "Watch"}[verdict]
    drag_prov = " (provisional)" if drag and legs[drag]["provisional"] else ""
    if verdict == "avoid":
        detail = "In a Stage-4 downtrend — stay away regardless of the numbers." if stage == 4 else f"{_LEG_LABEL[drag].capitalize()} drag the case{drag_prov}."
    elif verdict == "act":
        detail = f"{_LEG_LABEL[dominant].capitalize()} lead; {_LEG_LABEL[drag]} the only soft spot{drag_prov}."
    else:
        detail = f"{_LEG_LABEL[dominant].capitalize()} support it but {_LEG_LABEL[drag]} hold it back{drag_prov} — watch, don't chase."
    clause = "the setup lines up" if verdict == "act" else "the case is weak" if verdict == "avoid" else "it's mixed"
    return interp(f"{word} — {clause}", tone, detail)

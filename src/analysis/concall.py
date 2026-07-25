"""Earnings-call (concall) summariser.

Two modes:
  - Heuristic (default, no API key): sentence extraction into buckets
    (guidance, risks, growth drivers, margins, capital allocation) plus a
    positive/cautious tone tilt. Fast, deterministic, free.
  - LLM (optional): if the `anthropic` package is installed and
    ANTHROPIC_API_KEY is set, `summarise_with_claude()` returns a structured
    narrative summary. Falls back to the heuristic if unavailable.

The goal is to turn a long transcript into a trackable digest of guidance and
risks for your re-rating / thesis notes.
"""
from __future__ import annotations

import os
import re
from collections import defaultdict

# Keyword lexicons -> bucket. Lowercased, matched on word/phrase boundaries.
LEXICON: dict[str, list[str]] = {
    "guidance": [
        "guidance", "guide", "outlook", "we expect", "we anticipate", "forecast",
        "full year", "full-year", "next quarter", "fiscal", "for the year",
        "target", "raising our", "lowering our", "reiterate", "reaffirm",
        "we now expect", "we see", "range of",
    ],
    "risks": [
        "risk", "headwind", "uncertain", "uncertainty", "challenge", "pressure",
        "weakness", "soft", "softness", "decline", "macro", "fx", "foreign exchange",
        "currency", "litigation", "regulatory", "supply chain", "inflation",
        "slowdown", "cautious", "caution", "delay", "impact", "tariff",
    ],
    "growth_drivers": [
        "growth", "demand", "record", "momentum", "new customer", "pipeline",
        "backlog", "bookings", "adoption", "expansion", "launch", "ramp",
        "accelerat", "strong", "outperform", "win", "market share", "traction",
    ],
    "margins": [
        "margin", "gross margin", "operating margin", "cost", "efficiency",
        "pricing", "profitability", "leverage", "opex", "operating expense",
    ],
    "capital_allocation": [
        "buyback", "repurchase", "dividend", "capex", "capital expenditure",
        "acquisition", "m&a", "debt", "balance sheet", "free cash flow",
        "return of capital", "deleverage",
    ],
}

_POS = {"record", "strong", "growth", "momentum", "outperform", "beat",
        "accelerat", "raising our", "confident", "robust", "win", "traction"}
_NEG = {"headwind", "weakness", "soft", "decline", "pressure", "uncertain",
        "cautious", "slowdown", "miss", "lowering our", "challenge", "delay"}

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")

# Compile each term with a leading word boundary so stems still match
# (e.g. "accelerat" -> accelerating) but substrings inside other words do not
# (e.g. "win" must NOT match inside "headwinds").
_TERM_RE: dict[str, list[re.Pattern]] = {
    bucket: [re.compile(r"\b" + re.escape(t)) for t in terms]
    for bucket, terms in LEXICON.items()
}


def split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text or "").strip()
    return [s.strip() for s in _SENT_SPLIT.split(text) if len(s.strip()) > 20]


def _matches(sentence_lower: str, patterns: list[re.Pattern]) -> bool:
    return any(p.search(sentence_lower) for p in patterns)


def summarise_transcript(text: str, *, max_per_bucket: int = 6) -> dict:
    """Rule-based structured digest of a transcript.

    Returns:
      {
        "buckets": {guidance: [...], risks: [...], ...},
        "tone": {"positive": int, "cautious": int, "tilt": "positive|cautious|neutral"},
        "n_sentences": int,
      }
    """
    sentences = split_sentences(text)
    buckets: dict[str, list[str]] = defaultdict(list)
    pos = neg = 0

    for s in sentences:
        low = s.lower()
        for bucket, patterns in _TERM_RE.items():
            if _matches(low, patterns) and len(buckets[bucket]) < max_per_bucket * 3:
                buckets[bucket].append(s)
        pos += sum(1 for t in _POS if t in low)
        neg += sum(1 for t in _NEG if t in low)

    # De-duplicate and cap each bucket, preferring longer (more specific) lines.
    trimmed: dict[str, list[str]] = {}
    for bucket, items in buckets.items():
        seen, uniq = set(), []
        for s in sorted(items, key=len, reverse=True):
            key = s[:80].lower()
            if key not in seen:
                seen.add(key)
                uniq.append(s)
        trimmed[bucket] = uniq[:max_per_bucket]

    tilt = "neutral"
    if pos > neg * 1.3:
        tilt = "positive"
    elif neg > pos * 1.3:
        tilt = "cautious"

    return {
        "buckets": {k: trimmed.get(k, []) for k in LEXICON},
        "tone": {"positive": pos, "cautious": neg, "tilt": tilt},
        "n_sentences": len(sentences),
    }


def format_digest(symbol: str, period: str, summary: dict) -> str:
    """Render a summarise_transcript() result as readable text."""
    lines = [f"# {symbol} {period} concall digest",
             f"_tone: {summary['tone']['tilt']} "
             f"(+{summary['tone']['positive']} / -{summary['tone']['cautious']}), "
             f"{summary['n_sentences']} sentences_", ""]
    titles = {
        "guidance": "Guidance / outlook",
        "risks": "Risks & headwinds",
        "growth_drivers": "Growth drivers",
        "margins": "Margins & costs",
        "capital_allocation": "Capital allocation",
    }
    for bucket, title in titles.items():
        items = summary["buckets"].get(bucket, [])
        if not items:
            continue
        lines.append(f"## {title}")
        lines += [f"- {s}" for s in items]
        lines.append("")
    return "\n".join(lines).strip()


# --- Optional Claude-powered summary --------------------------------------

CLAUDE_MODEL = os.getenv("CONCALL_LLM_MODEL", "claude-sonnet-5")

_LLM_PROMPT = """You are an equity analyst. Summarise this earnings-call \
transcript into a concise, trackable digest with these sections, using short \
bullet points and quoting concrete numbers/guidance where stated:

1. Guidance & outlook (next quarter / full year, any raise or cut)
2. Growth drivers (demand, new products, backlog)
3. Risks & headwinds (macro, FX, competition, supply)
4. Margins & costs
5. Capital allocation (buybacks, dividend, capex, M&A, debt)
6. Re-rating watch: 1-2 lines on whether guidance/tone supports a higher \
multiple, and what would confirm or break it.

Transcript:
{transcript}"""


def summarise_with_claude(text: str, *, max_chars: int = 45000) -> str:
    """LLM summary via the Claude API. Requires `anthropic` + ANTHROPIC_API_KEY.

    Raises RuntimeError with guidance if the dependency/key is missing so the
    caller can fall back to summarise_transcript().
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set; use the heuristic summariser.")
    try:
        import anthropic  # noqa: PLC0415
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("pip install anthropic to use the LLM summariser.") from e

    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1500,
        messages=[{"role": "user",
                   "content": _LLM_PROMPT.format(transcript=text[:max_chars])}],
    )
    return "".join(block.text for block in msg.content if block.type == "text")

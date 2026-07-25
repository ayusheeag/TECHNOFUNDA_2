"""Generate a golden parity fixture for the web dataProvider's analysis.ts.

Runs the REAL Python analysis (src/analysis/stage.py::classify_stage,
screener.py::rs_line_new_high, stage.py::_rsi) on a deterministic multi-stage
price series and dumps closes/bench/dates + expected outputs to JSON. The
TypeScript port (web/src/lib/dataProvider/analysis.ts) is asserted against this
fixture in analysis.test.ts, tying the port to the source of truth.

Run from repo root:  python scripts/gen_chart_parity_fixture.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.analysis.stage import classify_stage, _rsi  # noqa: E402
from src.analysis.screener import rs_line_new_high  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "dataProvider" / "__fixtures__" / "parity.json"

# --- deterministic multi-stage series (numpy Generator with a fixed seed) ----
# Piecewise drift/vol so the series visibly traverses Weinstein stages 1→2→3→4.
PHASES = [
    (200, 0.0000, 0.010),   # pre-roll base (warmup so MA/slope valid)
    (120, 0.0003, 0.011),   # stage 1 base
    (260, 0.0022, 0.014),   # stage 2 markup
    (120, -0.0001, 0.018),  # stage 3 top
    (200, -0.0026, 0.017),  # stage 4 decline
    (100, 0.0000, 0.011),   # tail re-base
]


def gen_series(seed: int, start: float, phases) -> list[float]:
    rng = np.random.default_rng(seed)
    p = start
    out = []
    for bars, drift, vol in phases:
        for _ in range(bars):
            p *= 1 + drift + (rng.random() - 0.5) * 2 * vol
            p = max(p, 0.5)
            out.append(round(float(p), 2))
    return out


def business_dates(n: int, anchor="2022-01-03") -> list[str]:
    dates, d = [], pd.Timestamp(anchor)
    while len(dates) < n:
        if d.weekday() < 5:  # Mon-Fri
            dates.append(d.strftime("%Y-%m-%d"))
        d += pd.Timedelta(days=1)
    return dates


def main() -> None:
    closes = gen_series(seed=42, start=30.0, phases=PHASES)
    n = len(closes)
    dates = business_dates(n)
    # Benchmark: steady uptrend, independent seed.
    bench = gen_series(seed=143, start=400.0, phases=[(n, 0.0004, 0.008)])
    bench = bench[:n]

    df = pd.DataFrame({"date": dates, "close": closes})
    bench_close = pd.Series(bench, index=dates)

    # Per-bar stage: classify_stage on each prefix (stage AT bar i).
    per_bar_stage: list[int | None] = []
    for i in range(n):
        res = classify_stage(df.iloc[: i + 1][["date", "close"]])
        per_bar_stage.append(res["stage"])

    latest = classify_stage(df[["date", "close"]])
    rs_val, rs_new_high = rs_line_new_high(df[["date", "close"]], bench_close)
    rsi_latest = _rsi(pd.Series(closes))

    # A few prefix RS checks to exercise the rolling logic.
    rs_probe = {}
    for i in (300, 500, 700, n - 1):
        v, nh = rs_line_new_high(df.iloc[: i + 1][["date", "close"]], bench_close)
        rs_probe[str(i)] = {"rs": v, "new_high": nh}

    fixture = {
        "_generated_by": "scripts/gen_chart_parity_fixture.py",
        "closes": closes,
        "bench": bench,
        "dates": dates,
        "expected": {
            "per_bar_stage": per_bar_stage,
            "latest": {
                "stage": latest["stage"],
                "ma150": latest["ma150"],
                "above_ma": latest["above_ma"],
                "ma_slope_pct": latest["ma_slope_pct"],
                "range_pos": latest["range_pos"],
                "rsi14": latest["rsi14"],
                "days": latest["days"],
            },
            "rs_latest": {"rs": rs_val, "new_high": rs_new_high},
            "rsi_latest": rsi_latest,
            "rs_probe": rs_probe,
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture), encoding="utf-8")
    print(f"wrote {OUT}  ({n} bars)")
    print("latest stage:", latest["stage"], latest["label"])
    print("stage distribution:", {s: per_bar_stage.count(s) for s in (None, 1, 2, 3, 4)})
    print("rs latest:", rs_val, "new_high:", rs_new_high, "rsi:", rsi_latest)


if __name__ == "__main__":
    main()

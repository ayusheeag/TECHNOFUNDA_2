"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { CrosshairPayload } from "@/lib/dataProvider";
import { price } from "@/lib/format";
import { direction } from "../tokens";

/** Interpretation-first crosshair card + an aria-live mirror so screen-reader
 *  users hear the verdict as the crosshair moves. The visual card updates in
 *  real time; the live region is DEBOUNCED (~450ms after the crosshair settles)
 *  so a mouse sweep across hundreds of bars doesn't flood assistive tech. */
export function CrosshairReadout({ payload }: { payload: CrosshairPayload | null }) {
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(payload ? `${payload.date}: ${payload.sentence}` : ""), 450);
    return () => clearTimeout(id);
  }, [payload]);

  return (
    <div className="mt-2 min-h-[2.5rem]">
      {/* aria-live mirror — announces only the settled value */}
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>

      {payload ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-2xs">
          <span className="tnum font-medium text-text">{payload.date}</span>
          <span className="tnum text-muted">
            O {price(payload.bar.open)} · H {price(payload.bar.high)} · L {price(payload.bar.low)} · C{" "}
            <span className="font-medium text-text">{price(payload.bar.close)}</span>
          </span>
          {payload.ma150 != null && (
            <span className={clsx("tnum", direction(payload.pctVsMa).className)}>
              {direction(payload.pctVsMa).arrow} {payload.pctVsMa == null ? "—" : `${Math.abs(payload.pctVsMa).toFixed(1)}%`} vs 150-day
            </span>
          )}
          <span className="text-faint">·</span>
          <span className="text-muted">{payload.sentence}</span>
        </div>
      ) : (
        <p className="px-1 text-2xs text-faint">Hover the chart for a bar-by-bar read.</p>
      )}
    </div>
  );
}

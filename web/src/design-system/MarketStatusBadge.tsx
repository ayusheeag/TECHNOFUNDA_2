"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";

type Phase = "open" | "pre" | "post" | "closed";

const META: Record<Phase, { label: string; dot: string; text: string }> = {
  open:   { label: "Market open",  dot: "bg-bull",  text: "text-bull" },
  pre:    { label: "Pre-market",   dot: "bg-warn",  text: "text-warn" },
  post:   { label: "After hours",  dot: "bg-warn",  text: "text-warn" },
  closed: { label: "Market closed", dot: "bg-faint", text: "text-muted" },
};

/** US equity session phase in America/New_York, computed client-side so it
 *  reflects the viewer's clock without a round-trip. Minute-of-day thresholds:
 *  pre 04:00, regular 09:30, post 16:00, closed 20:00. Weekends → closed. */
function phaseNow(): Phase {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return "closed";
  const h = parseInt(get("hour"), 10) % 24;
  const m = parseInt(get("minute"), 10);
  const mins = h * 60 + m;
  if (mins < 4 * 60) return "closed";
  if (mins < 9 * 60 + 30) return "pre";
  if (mins < 16 * 60) return "open";
  if (mins < 20 * 60) return "post";
  return "closed";
}

function ago(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const mnt = Math.round(s / 60);
  if (mnt < 60) return `${mnt}m ago`;
  const hr = Math.round(mnt / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export interface MarketStatusBadgeProps {
  /** ISO timestamp of the latest data snapshot. */
  updatedAt?: string;
  className?: string;
}

export function MarketStatusBadge({ updatedAt, className }: MarketStatusBadgeProps) {
  // Avoid hydration mismatch: render neutral until mounted, then live-update.
  const [phase, setPhase] = useState<Phase | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    setPhase(phaseNow());
    const id = setInterval(() => {
      setPhase(phaseNow());
      tick((n) => n + 1);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const meta = phase ? META[phase] : META.closed;
  // `ago()` reads Date.now(), so only render it AFTER mount (phase != null) —
  // otherwise the SSR string and the first client render can disagree and the
  // mismatch is in a child span the div's suppressHydrationWarning can't cover.
  const rel = phase != null ? ago(updatedAt) : null;
  return (
    <div className={clsx("inline-flex items-center gap-1.5 text-2xs", className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", meta.dot, phase === "open" && "animate-pulse")} aria-hidden />
      <span className={clsx("font-medium", meta.text)}>{meta.label}</span>
      {rel && <span className="text-faint">· updated {rel}</span>}
    </div>
  );
}

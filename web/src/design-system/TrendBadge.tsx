import clsx from "clsx";
import { direction } from "./tokens";
import { pct } from "@/lib/format";

export interface TrendBadgeProps {
  /** The change value; % by default. */
  value: number | null | undefined;
  /** Render as a % (default) or a raw number. */
  format?: "pct" | "raw";
  size?: "sm" | "md";
  /** Soft-filled chip vs inline text. */
  variant?: "chip" | "inline";
  className?: string;
}

/** Direction indicator that never relies on color alone — always shows an
 *  arrow (▲/▼/▬) and an explicit +/− sign alongside the bull/bear color. */
export function TrendBadge({
  value, format = "pct", size = "md", variant = "chip", className,
}: TrendBadgeProps) {
  const d = direction(value);
  const label =
    value == null ? "—"
    : format === "pct" ? pct(value)
    : `${d.sign}${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  const bg =
    d.dir === "up" ? "bg-bull-soft" : d.dir === "down" ? "bg-bear-soft" : "bg-surface-2";

  return (
    <span
      className={clsx(
        "tnum inline-flex items-center gap-1 font-medium",
        d.className,
        size === "sm" ? "text-xs" : "text-sm",
        variant === "chip" && clsx(bg, "rounded-full px-2 py-0.5"),
        className,
      )}
      aria-label={`${d.dir === "up" ? "up" : d.dir === "down" ? "down" : "flat"} ${label}`}
    >
      <span aria-hidden className="text-[0.75em] leading-none">{d.arrow}</span>
      {label}
    </span>
  );
}

"use client";
import { useMemo } from "react";
import clsx from "clsx";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** Override auto direction color (up=bull, down=bear based on first→last). */
  tone?: "bull" | "bear" | "neutral";
  showArea?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Tiny SVG trend line. Transform is memoized (perf rule). Color derives from
 *  first→last direction unless `tone` is forced. */
export function Sparkline({
  data, width = 88, height = 28, tone, showArea = true, className, ...aria
}: SparklineProps) {
  const { line, area, dir } = useMemo(() => {
    if (!data || data.length < 2) return { line: "", area: "", dir: "neutral" as const };
    const min = Math.min(...data), max = Math.max(...data);
    const span = max - min || 1;
    const dx = width / (data.length - 1);
    const y = (v: number) => height - ((v - min) / span) * (height - 4) - 2;
    const pts = data.map((v, i) => `${(i * dx).toFixed(2)},${y(v).toFixed(2)}`);
    const line = "M" + pts.join(" L");
    const area = `${line} L${width},${height} L0,${height} Z`;
    const dir = data[data.length - 1] >= data[0] ? ("bull" as const) : ("bear" as const);
    return { line, area, dir };
  }, [data, width, height]);

  const color =
    tone === "bull" ? "var(--bull)" : tone === "bear" ? "var(--bear)"
    : tone === "neutral" ? "var(--muted)"
    : dir === "bull" ? "var(--bull)" : "var(--bear)";

  return (
    <svg
      width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      className={clsx("overflow-visible", className)} role="img"
      aria-label={aria["aria-label"] ?? "price trend sparkline"}
    >
      {showArea && line && (
        <path d={area} fill={color} opacity={0.12} />
      )}
      {line && (
        <path d={line} fill="none" stroke={color} strokeWidth={1.5}
          strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

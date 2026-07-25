import clsx from "clsx";

export interface SkeletonProps {
  variant?: "line" | "block" | "circle" | "card" | "row";
  count?: number;
  className?: string;
}

/** Shimmer placeholder for async surfaces (skeletons-everywhere rule). */
export function SkeletonLoader({ variant = "line", count = 1, className }: SkeletonProps) {
  const items = Array.from({ length: count });
  const base = "relative overflow-hidden bg-surface-2 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/5 before:to-transparent";

  if (variant === "card")
    return (
      <div className={clsx("space-y-2", className)} aria-hidden>
        {items.map((_, i) => (
          <div key={i} className={clsx(base, "h-24 rounded-lg border border-border")} />
        ))}
      </div>
    );

  if (variant === "row")
    return (
      <div className={clsx("space-y-1.5", className)} aria-hidden>
        {items.map((_, i) => (
          <div key={i} className={clsx(base, "h-12 rounded-lg")} />
        ))}
      </div>
    );

  const shape =
    variant === "circle" ? "h-10 w-10 rounded-full"
    : variant === "block" ? "h-20 w-full rounded-lg"
    : "h-3.5 w-full rounded";

  return (
    <div className={clsx("space-y-2", className)} aria-hidden>
      {items.map((_, i) => (
        <div key={i} className={clsx(base, shape)} />
      ))}
    </div>
  );
}

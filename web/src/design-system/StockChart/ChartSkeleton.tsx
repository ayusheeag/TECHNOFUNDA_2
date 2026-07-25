import { SkeletonLoader } from "../SkeletonLoader";

/** Sized to the chart's exact `height` so the ssr:false canvas swap causes no
 *  layout shift (the canvas renders zero server HTML). */
export function ChartSkeleton({ height = 460 }: { height?: number }) {
  return (
    <div aria-hidden>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="space-y-2">
          <SkeletonLoader variant="line" className="w-40" />
          <SkeletonLoader variant="line" className="w-64" />
        </div>
        <SkeletonLoader variant="circle" />
      </div>
      <div
        className="relative overflow-hidden rounded-lg border border-border bg-surface-2 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/5 before:to-transparent"
        style={{ height }}
      />
    </div>
  );
}

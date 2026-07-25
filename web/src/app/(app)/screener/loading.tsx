import { SkeletonLoader } from "@/design-system";

export default function ScreenerLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" aria-live="polite">Loading the shortlist…</span>
      <SkeletonLoader variant="line" className="h-6 w-48" />
      <SkeletonLoader variant="line" className="h-9 w-full" />
      <SkeletonLoader variant="row" count={10} />
    </div>
  );
}

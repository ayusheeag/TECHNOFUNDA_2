import { SkeletonLoader } from "@/design-system";

export default function StockDetailLoading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <span className="sr-only" aria-live="polite">Loading stock detail…</span>
      <div className="space-y-2">
        <SkeletonLoader variant="line" className="h-6 w-40" />
        <SkeletonLoader variant="line" className="h-8 w-52" />
      </div>
      <SkeletonLoader variant="block" className="h-24" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SkeletonLoader variant="block" className="h-16" />
        <SkeletonLoader variant="block" className="h-16" />
        <SkeletonLoader variant="block" className="h-16" />
        <SkeletonLoader variant="block" className="h-16" />
      </div>
      <SkeletonLoader variant="block" className="h-80" />
    </div>
  );
}

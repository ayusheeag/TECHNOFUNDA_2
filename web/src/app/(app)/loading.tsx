import { SkeletonLoader } from "@/design-system";

export default function PulseLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" aria-live="polite">Loading market pulse…</span>
      <SkeletonLoader variant="line" className="h-6 w-64" />
      <SkeletonLoader variant="block" className="h-28" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SkeletonLoader variant="block" className="h-24" />
        <SkeletonLoader variant="block" className="h-24" />
      </div>
      <SkeletonLoader variant="row" count={6} />
    </div>
  );
}

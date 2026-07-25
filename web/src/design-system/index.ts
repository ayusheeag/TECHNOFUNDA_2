/** TechnoFunda design system — public surface.
 *  Import from "@/design-system" everywhere in the app. */

// Tokens & semantic maps
export * from "./tokens";

// Primitives
export { Sparkline } from "./Sparkline";
export type { SparklineProps } from "./Sparkline";
export { TrendBadge } from "./TrendBadge";
export type { TrendBadgeProps } from "./TrendBadge";
export { MetricPill } from "./MetricPill";
export type { MetricPillProps } from "./MetricPill";
export { ScoreRing } from "./ScoreRing";
export type { ScoreRingProps } from "./ScoreRing";
export { SegmentedControl } from "./SegmentedControl";
export type { SegmentedControlProps, SegmentOption } from "./SegmentedControl";

// Composite / list
export { StockRow } from "./StockRow";
export type { StockRowProps } from "./StockRow";
export { StockCard } from "./StockCard";
export type { StockCardProps, ScreenReason } from "./StockCard";

// Overlays & status
export { BottomSheet } from "./BottomSheet";
export type { BottomSheetProps } from "./BottomSheet";
export { MarketStatusBadge } from "./MarketStatusBadge";
export type { MarketStatusBadgeProps } from "./MarketStatusBadge";

// Charts
export { StockChart } from "./StockChart";
export type { StockChartProps } from "./StockChart";

// Phase 3 — badges & spine
export { VerdictChip } from "./VerdictChip";
export { StageBadge } from "./StageBadge";
export { SectorChip } from "./SectorChip";
export { RegimeBadge } from "./RegimeBadge";

// Phase 3 — data surfaces
export { CompositeScoreCard } from "./CompositeScoreCard";
export { SectorLeaderboard } from "./SectorLeaderboard";
export { BreadthSparkCard } from "./BreadthSparkCard";
export { FinancialsTable } from "./FinancialsTable";
export { NewsCard } from "./NewsCard";
export { ConcallDigest } from "./ConcallDigest";
export { EarningsCalendar } from "./EarningsCalendar";
export { WatchlistCard } from "./WatchlistCard";
export { WatchStar } from "./WatchStar";

// Phase 3 — screener + virtualization
export { ScreenerTable } from "./ScreenerTable";
export { ScreenerFilters } from "./ScreenerFilters";
export { VirtualList } from "./VirtualList";
export type { VirtualListProps } from "./VirtualList";

// Async / empty / legal
export { SkeletonLoader } from "./SkeletonLoader";
export type { SkeletonProps } from "./SkeletonLoader";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
export { Disclaimer } from "./Disclaimer";
export type { DisclaimerProps } from "./Disclaimer";

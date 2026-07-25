// One app-wide "today" so earnings dates, daysUntil, and news recency are
// deterministic (never Date.now — that would break SSR byte-stability + tests).
// meta.marketPhase / meta.generatedAt may read the wall clock; nothing that
// feeds a series value ever does.
export const MOCK_TODAY = "2025-10-31"; // a Friday

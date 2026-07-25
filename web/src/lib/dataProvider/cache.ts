// US-market-hours-aware cache stub (MIGRATION §3.2). marketPhase() reads the
// ET wall-clock and feeds ONLY meta.marketPhase — it NEVER touches series
// values, so SSR and CSR series stay byte-identical. withCache is a no-op in
// mock mode (always recompute → determinism) but real-shaped so realProvider
// drops in unchanged.
import type { MarketPhase } from "./types";

/** US equity session phase in America/New_York. Holiday calendar is a TODO stub. */
export function marketPhase(now: Date = new Date()): MarketPhase {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return "WEEKEND";
  const mins = (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10);
  if (mins < 4 * 60) return "CLOSED";
  if (mins < 9 * 60 + 30) return "PREMARKET";
  if (mins < 16 * 60) return "RTH";
  if (mins < 20 * 60) return "POSTMARKET";
  return "CLOSED";
}

/** §3.2 TTL table (seconds). CLOSED/WEEKEND use a long TTL (until roughly next open). */
export function ttlForPhase(phase: MarketPhase): number {
  switch (phase) {
    case "RTH":
      return 90; // 60–120s during regular hours
    case "PREMARKET":
    case "POSTMARKET":
      return 300;
    case "CLOSED":
      return 3600;
    default:
      return 6 * 3600; // WEEKEND / HOLIDAY
  }
}

interface Entry<T> {
  v: T;
  exp: number;
}
const store = new Map<string, Entry<unknown>>();

/**
 * TTL memo keyed by (mode:symbol:opts). Used by realProvider. In mock mode the
 * provider bypasses this and recomputes so output is always deterministic.
 */
export async function withCache<T>(key: string, phase: MarketPhase, fn: () => Promise<T>): Promise<{ value: T; stale: boolean }> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.exp > now) return { value: hit.v, stale: false };
  const value = await fn();
  store.set(key, { v: value, exp: now + ttlForPhase(phase) * 1000 });
  return { value, stale: false };
}

export function cacheKey(mode: string, symbol: string, opts: unknown): string {
  return `${mode}:${symbol}:${JSON.stringify(opts ?? {})}`;
}

// The watchlist RESOURCE (mock): a localStorage list of SYMBOLS only — every
// other field is derived deterministically, so it survives schema changes.
// Components never touch this directly; they go through the provider / the
// useWatchlist hook. SSR-safe: server reads return the seed; private-mode
// storage errors fall back to an in-memory list.
const KEY = "tf-watchlist";
const SEED = ["NVDA", "LLY", "JPM"];
export const WATCHLIST_CHANGED = "tf-watchlist-changed";
const MAX = 50;

let _mem: string[] | null = null; // private-mode / SSR fallback

function read(): string[] {
  if (typeof window === "undefined") return [...SEED];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw == null) return _mem ? [..._mem] : [...SEED];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, MAX) : [...SEED];
  } catch {
    return _mem ? [..._mem] : [...SEED];
  }
}

function write(list: string[]): void {
  const capped = list.slice(0, MAX);
  _mem = capped;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(capped));
  } catch {
    /* private mode → in-memory only */
  }
  try {
    window.dispatchEvent(new CustomEvent(WATCHLIST_CHANGED));
  } catch {
    /* no-op */
  }
}

export function listSymbols(): string[] {
  return read();
}
export function isWatched(symbol: string): boolean {
  return read().includes(symbol.toUpperCase());
}
export function addSymbol(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const list = read();
  if (!list.includes(s)) list.unshift(s);
  write(list);
  return list;
}
export function removeSymbol(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const list = read().filter((x) => x !== s);
  write(list);
  return list;
}

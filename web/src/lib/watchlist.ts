"use client";
// Client-side watchlist facade used by WatchStar — engine-free (never imports
// the mock provider) so it stays out of every route's bundle. Mock mode reads
// the localStorage symbol list; api mode calls the per-user server watchlist
// with the SAME `tf-uid` the realProvider uses. A cached Set backs a sync
// has() for instant star toggles.
import { WATCHLIST_CHANGED, addSymbol, isWatched as storeIsWatched, listSymbols, removeSymbol } from "./dataProvider/watchlistStore";

const API = process.env.NEXT_PUBLIC_API_URL;
const IS_API = process.env.NEXT_PUBLIC_DATA_MODE === "api" && !!API;

function uid(): string {
  if (typeof window === "undefined") return "anon";
  try {
    let id = localStorage.getItem("tf-uid");
    if (!id) {
      id = crypto?.randomUUID?.() ?? `u-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("tf-uid", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

const headers = () => ({ "content-type": "application/json", "X-User-Id": uid() });

let _set: Set<string> | null = null; // hydrated symbol cache (api mode)
let _loading: Promise<void> | null = null;

function fire() {
  try {
    window.dispatchEvent(new CustomEvent(WATCHLIST_CHANGED));
  } catch {}
}

/** Populate the cache (api mode) so has() is synchronous. Mock reads the store live. */
export function ensureLoaded(): Promise<void> {
  if (!IS_API) return Promise.resolve();
  if (_set) return Promise.resolve();
  if (!_loading) {
    _loading = fetch(`${API!.replace(/\/$/, "")}/watchlist`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((items: { symbol: string }[]) => {
        _set = new Set(items.map((i) => i.symbol.toUpperCase()));
      })
      .catch(() => {
        _set = new Set();
      })
      .finally(() => {
        _loading = null;
      });
  }
  return _loading;
}

export function has(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return IS_API ? !!_set?.has(s) : storeIsWatched(s);
}

export async function add(symbol: string): Promise<void> {
  const s = symbol.toUpperCase();
  if (IS_API) {
    await fetch(`${API!.replace(/\/$/, "")}/watchlist`, { method: "POST", headers: headers(), body: JSON.stringify({ symbol: s }) });
    _set?.add(s);
  } else {
    addSymbol(s);
  }
  fire();
}

export async function remove(symbol: string): Promise<void> {
  const s = symbol.toUpperCase();
  if (IS_API) {
    await fetch(`${API!.replace(/\/$/, "")}/watchlist/${encodeURIComponent(s)}`, { method: "DELETE", headers: headers() });
    _set?.delete(s);
  } else {
    removeSymbol(s);
  }
  fire();
}

export function subscribe(fn: () => void): () => void {
  window.addEventListener(WATCHLIST_CHANGED, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(WATCHLIST_CHANGED, fn);
    window.removeEventListener("storage", fn);
  };
}

export { listSymbols };

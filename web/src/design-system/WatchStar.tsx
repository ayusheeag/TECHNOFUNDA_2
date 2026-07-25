"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
// Import the tiny, engine-free store directly (NOT the monolithic provider), so
// WatchStar ships no mock-engine code — it only reads/writes a symbol list.
import { WATCHLIST_CHANGED, addSymbol, isWatched, removeSymbol } from "@/lib/dataProvider/watchlistStore";

/** Instant add/remove toggle. Reads the sync isWatched, mutates via the
 *  provider, and stays in sync across the app via the watchlist-changed event
 *  (and cross-tab via 'storage'). Renders neutral on the server → no hydration
 *  mismatch (the list lives in localStorage, unknown at SSR). */
export function WatchStar({ symbol, className }: { symbol: string; className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    setMounted(true);
    const sync = () => setWatched(isWatched(symbol));
    sync();
    window.addEventListener(WATCHLIST_CHANGED, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WATCHLIST_CHANGED, sync);
      window.removeEventListener("storage", sync);
    };
  }, [symbol]);

  const on = mounted && watched;
  const toggle = () => {
    if (isWatched(symbol)) removeSymbol(symbol);
    else addSymbol(symbol);
    setWatched(isWatched(symbol));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      className={clsx("min-h-touch min-w-touch inline-flex items-center justify-center rounded-full text-lg transition-colors", on ? "text-warn" : "text-faint hover:text-text", className)}
    >
      <span aria-hidden suppressHydrationWarning>{on ? "★" : "☆"}</span>
    </button>
  );
}

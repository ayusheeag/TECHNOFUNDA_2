"use client";
import { useEffect, useState } from "react";
import clsx from "clsx";
// Mode-aware, engine-free watchlist facade (mock: localStorage; api: per-user
// server watchlist). WatchStar ships no mock-engine code.
import { add, ensureLoaded, has, remove, subscribe } from "@/lib/watchlist";

/** Instant add/remove toggle. Renders neutral on the server (the list is
 *  client-only), hydrates on mount, and stays in sync app-wide via the
 *  watchlist-changed event (and cross-tab via 'storage'). */
export function WatchStar({ symbol, className }: { symbol: string; className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    setMounted(true);
    let alive = true;
    const sync = () => alive && setWatched(has(symbol));
    ensureLoaded().then(sync);
    const unsub = subscribe(sync);
    return () => {
      alive = false;
      unsub();
    };
  }, [symbol]);

  const on = mounted && watched;
  const toggle = async () => {
    if (has(symbol)) await remove(symbol);
    else await add(symbol);
    setWatched(has(symbol));
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

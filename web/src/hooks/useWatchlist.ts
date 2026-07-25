"use client";
import { useCallback, useEffect, useState } from "react";
import { WATCHLIST_CHANGED, dataProvider, type WatchItem } from "@/lib/dataProvider";

/** SSR-safe watchlist read/subscribe + optimistic add/remove. The list lives in
 *  localStorage behind the provider; this hook reads it on mount (so the server
 *  never emits a personalized list it can't match) and stays live via the
 *  watchlist-changed event. */
export function useWatchlist() {
  const [items, setItems] = useState<WatchItem[] | null>(null); // null = not yet loaded (server/first paint)

  const refresh = useCallback(() => {
    dataProvider.getWatchlist().then(setItems).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(WATCHLIST_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(WATCHLIST_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const add = useCallback(async (symbol: string) => {
    await dataProvider.addToWatchlist(symbol);
    refresh();
  }, [refresh]);

  const remove = useCallback(async (symbol: string) => {
    await dataProvider.removeFromWatchlist(symbol);
    refresh();
  }, [refresh]);

  return { items, loading: items === null, add, remove, refresh };
}

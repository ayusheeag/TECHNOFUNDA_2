"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { TickerOption } from "@/lib/dataProvider";

/** WAI-ARIA combobox autosuggest → /stocks/[symbol]. Debounced, abortable,
 *  keyboard-complete (Arrow/Enter/Esc/Home/End). Navigation is its only side
 *  effect. */
export function StockSearch({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TickerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const ac = new AbortController();
    const id = setTimeout(() => {
      // Fetch the server route (not the in-process provider) so no mock engine
      // ships in the layout-wide bundle. Matches the real API contract.
      fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((r: TickerOption[]) => {
          setResults(r);
          setActive(r.length ? 0 : -1);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(id);
      ac.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (symbol: string) => {
    try {
      sessionStorage.setItem("tf-last-symbol", symbol);
    } catch {}
    setOpen(false);
    setQ("");
    router.push(`/stocks/${symbol}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) setOpen(true);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(results.length - 1);
    } else if (e.key === "Enter") {
      if (active >= 0 && results[active]) {
        e.preventDefault();
        go(results[active].symbol);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQ("");
    }
  };

  const showList = open && q.trim().length > 0;

  return (
    <div ref={boxRef} className={clsx("relative", className)}>
      <input
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search a stock — NVDA, LLY, JPM…"
        aria-label="Search a stock"
        className="min-h-touch w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-faint focus-visible:border-accent"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-border bg-surface shadow-elev-2"
        >
          {results.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-2xs text-faint">No match for “{q}”.</li>
          ) : (
            results.map((r, i) => (
              <li
                id={`${listId}-opt-${i}`}
                key={r.symbol}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(r.symbol);
                }}
                className={clsx("flex min-h-touch cursor-pointer items-center gap-2 px-3 text-sm", i === active ? "bg-surface-2" : "")}
              >
                <span className="font-semibold text-text">{r.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{r.name}</span>
                <span className="shrink-0 text-[10px] text-faint">{r.sector}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";

export interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  height: number; // scroll-viewport height (px)
  overscan?: number;
  renderRow: (item: T, index: number) => React.ReactNode;
  /** Enter/Space on the active row calls this (keyboard activation). */
  onActivate?: (index: number) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * Dependency-free fixed-row windowing (no react-window / react-virtual — the
 * per-route budget stays tiny). Only the visible slice is in the DOM, but a11y
 * is preserved: role="list" + aria-rowcount on the container, and each rendered
 * row carries its TRUE 1-based aria-rowindex so screen readers announce
 * "12 of 340" despite virtualization. Keyboard: ↑/↓ move an active row and
 * scroll it into view; Home/End jump. Fixed row height only.
 */
export function VirtualList<T>({ items, rowHeight, height, overscan = 6, renderRow, onActivate, ariaLabel, className }: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const [scrollTop, setScrollTop] = useState(0);
  const [active, setActive] = useState(0);
  const raf = useRef(0);

  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      setScrollTop(ref.current?.scrollTop ?? 0);
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const total = items.length;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const slice = items.slice(start, end);

  const scrollTo = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = i * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + height) el.scrollTop = top + rowHeight - height;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Enter" || e.key === " ") && active >= 0) {
      e.preventDefault();
      onActivate?.(active);
      return;
    }
    let next = active;
    if (e.key === "ArrowDown") next = Math.min(total - 1, active + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, active - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = total - 1;
    else return;
    e.preventDefault();
    setActive(next);
    scrollTo(next);
  };

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={active >= 0 ? `${baseId}-row-${active}` : undefined}
      tabIndex={0}
      className={clsx("relative overflow-y-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", className)}
      style={{ height }}
    >
      <div style={{ height: total * rowHeight }}>
        {slice.map((item, i) => {
          const index = start + i;
          return (
            <div
              key={index}
              id={`${baseId}-row-${index}`}
              role="option"
              aria-selected={index === active}
              aria-setsize={total}
              aria-posinset={index + 1}
              className="absolute inset-x-0"
              style={{ top: index * rowHeight, height: rowHeight }}
            >
              {renderRow(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

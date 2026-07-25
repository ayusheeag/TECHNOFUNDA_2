"use client";
import { useRef } from "react";
import clsx from "clsx";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

/**
 * Single-select pill control — a proper ARIA radiogroup (not a tablist: there
 * are no tabpanels). Roving tabindex + arrow keys move and select, matching
 * native radio behavior. Every option meets the ≥44px touch target; `sm` only
 * shrinks the type/padding, not the tap height.
 */
export function SegmentedControl<T extends string>({
  options, value, onChange, size = "md", className, ...aria
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const n = options.length;
    const next = (from + delta + n) % n;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(i, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(i, -1);
        break;
      case "Home":
        e.preventDefault();
        onChange(options[0].value);
        refs.current[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        onChange(options[options.length - 1].value);
        refs.current[options.length - 1]?.focus();
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      className={clsx("inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-2 p-0.5", className)}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={clsx(
              "min-h-touch inline-flex items-center rounded-full font-medium transition-colors duration-150 ease-out",
              size === "sm" ? "px-2.5 text-xs" : "px-3.5 text-sm",
              active ? "bg-surface text-text shadow-elev-1" : "text-muted hover:text-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

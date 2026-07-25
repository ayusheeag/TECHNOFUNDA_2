"use client";
import clsx from "clsx";
import type { Stock } from "@/lib/types";
import { price } from "@/lib/format";
import { STAGE } from "./tokens";
import { Sparkline } from "./Sparkline";
import { TrendBadge } from "./TrendBadge";

export interface StockRowProps {
  stock: Stock;
  onClick?: (symbol: string) => void;
  href?: string;
  /** Optional right-side note, e.g. distance from entry on the watchlist. */
  note?: string;
  className?: string;
}

/** Compact list row: identity → sparkline → price + change. ≥44px touch target.
 *  The trend badge + arrow means direction survives without color. */
export function StockRow({ stock, onClick, href, note, className }: StockRowProps) {
  const El: any = href ? "a" : "button";
  const stage = stock.stage ? STAGE[stock.stage] : null;
  return (
    <El
      {...(href ? { href } : { type: "button", onClick: () => onClick?.(stock.symbol) })}
      className={clsx(
        "flex min-h-touch w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
        "transition-colors duration-150 ease-out hover:bg-surface-2 focus-visible:bg-surface-2",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-text">{stock.symbol}</span>
          {stage && <span aria-hidden title={stage.label}>{stage.glyph}</span>}
          {stock.rsNewHigh && (
            <span className="rounded bg-accent-soft px-1 text-[10px] font-medium text-accent" title="Relative-strength line at a new high">RS↑</span>
          )}
        </div>
        <div className="truncate text-2xs text-muted">{stock.name}</div>
      </div>

      <Sparkline data={stock.spark ?? []} className="shrink-0" />

      <div className="w-24 shrink-0 text-right">
        <div className="tnum text-sm font-semibold text-text">{price(stock.price)}</div>
        <div className="mt-0.5 flex justify-end">
          <TrendBadge value={stock.changePct} size="sm" variant="inline" />
        </div>
        {note && <div className="mt-0.5 text-[10px] text-faint">{note}</div>}
      </div>
    </El>
  );
}

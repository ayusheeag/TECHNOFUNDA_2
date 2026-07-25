"use client";
import clsx from "clsx";
import type { Stock } from "@/lib/types";
import { price, formatUSD } from "@/lib/format";
import { STAGE } from "./tokens";
import { Sparkline } from "./Sparkline";
import { TrendBadge } from "./TrendBadge";

export interface ScreenReason {
  label: string;
  value: string;
}

export interface StockCardProps {
  stock: Stock;
  /** The 2–3 metrics that got this stock through the screen (Screener rule). */
  reasons?: ScreenReason[];
  verdict?: string; // composite verdict chip
  onClick?: (symbol: string) => void;
  href?: string;
  className?: string;
}

/** Idea card for the screener: identity + price + why-it-passed + sparkline.
 *  Answers "why is this here?" at a glance. */
export function StockCard({ stock, reasons, verdict, onClick, href, className }: StockCardProps) {
  const El: any = href ? "a" : "button";
  const stage = stock.stage ? STAGE[stock.stage] : null;
  return (
    <El
      {...(href ? { href } : { type: "button", onClick: () => onClick?.(stock.symbol) })}
      className={clsx(
        "block w-full rounded-lg border border-border bg-surface p-3 text-left shadow-elev-1",
        "transition-all duration-150 ease-out hover:border-accent hover:shadow-elev-2 focus-visible:border-accent",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-text">{stock.symbol}</span>
            {stage && <span aria-hidden title={stage.label}>{stage.glyph}</span>}
          </div>
          <div className="truncate text-2xs text-muted">{stock.name}</div>
        </div>
        {verdict && (
          <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">{verdict}</span>
        )}
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="tnum text-lg font-semibold text-text">{price(stock.price)}</div>
          <TrendBadge value={stock.changePct} size="sm" />
        </div>
        <Sparkline data={stock.spark ?? []} width={100} height={32} />
      </div>

      {reasons && reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
          {reasons.map((r) => (
            <span key={r.label} className="tnum rounded bg-surface-2 px-1.5 py-0.5 text-2xs text-muted">
              <span className="text-faint">{r.label} </span>
              <span className="font-medium text-text">{r.value}</span>
            </span>
          ))}
        </div>
      )}
      {stock.marketCap != null && (
        <div className="mt-1.5 text-[10px] text-faint">Mkt cap {formatUSD(stock.marketCap)}</div>
      )}
    </El>
  );
}

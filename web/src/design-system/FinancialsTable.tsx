import type { FinancialRow } from "@/lib/dataProvider";
import { formatUSD } from "@/lib/format";
import { direction } from "./tokens";

function yoyCell(v: number | null) {
  if (v == null) return <span className="text-faint">n/a</span>;
  const d = direction(v);
  return (
    <span className={`tnum ${d.className}`}>
      <span aria-hidden>{d.arrow}</span> {Math.abs(v).toFixed(0)}%
    </span>
  );
}

/** Annual/quarterly financials. Revenue in $B/$M, EPS in $, YoY as arrow cells.
 *  Newest period first. Scrolls horizontally on narrow screens. */
export function FinancialsTable({ rows, kind }: { rows: FinancialRow[]; kind: "annual" | "quarterly" }) {
  const ordered = rows.slice().reverse(); // newest first
  const th = "px-2 py-1.5 text-right font-medium text-muted whitespace-nowrap";
  const td = "tnum px-2 py-1.5 text-right text-text whitespace-nowrap";
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{kind === "annual" ? "Annual" : "Quarterly"} financials, newest first</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-2 py-1.5 text-left font-medium text-muted">Period</th>
            <th scope="col" className={th}>Revenue</th>
            <th scope="col" className={th}>Rev YoY</th>
            <th scope="col" className={th}>EPS</th>
            <th scope="col" className={th}>EPS YoY</th>
            <th scope="col" className={th}>Gross&nbsp;margin</th>
            <th scope="col" className={th}>FCF</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.period} className="border-b border-border last:border-0">
              <td className="px-2 py-1.5 text-left font-medium text-text whitespace-nowrap">{r.period}</td>
              <td className={td}>{formatUSD(r.revenue)}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{yoyCell(r.revenueYoY)}</td>
              <td className={td}>${r.eps.toFixed(2)}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{yoyCell(r.epsYoY)}</td>
              <td className={td}>{r.grossMargin == null ? "—" : `${r.grossMargin.toFixed(0)}%`}</td>
              <td className={td}>{r.fcf == null ? "—" : formatUSD(r.fcf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

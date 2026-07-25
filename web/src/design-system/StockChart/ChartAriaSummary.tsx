import type { StockChartResponse } from "@/lib/dataProvider";

/** Always-rendered sr-only paragraph — the canonical screen-reader description
 *  of a chart whose canvas pixels are unreachable to assistive tech. The string
 *  is built server-side in the provider (from the raw slope), so it never
 *  contradicts the stage read and the client ships no summary-building code. */
export function ChartAriaSummary({ data, id }: { data: StockChartResponse; id?: string }) {
  return (
    <p id={id} className="sr-only">
      {data.ariaSummary}
    </p>
  );
}

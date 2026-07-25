import clsx from "clsx";
import type { StockChartResponse } from "@/lib/dataProvider";
import { price } from "@/lib/format";
import { STAGE, TONE_CLASS } from "../tokens";
import { TrendBadge } from "../TrendBadge";
import { RSNewHighBadge } from "./RSNewHighBadge";

/** Chart header: identity + stage verdict + price + RS leadership + the one
 *  plain-English sentence. Answers "what stage, is it leading, what do I do". */
export function ChartHeader({ data, showRS, onToggleRS }: { data: StockChartResponse; showRS: boolean; onToggleRS: () => void }) {
  const bars = data.bars;
  const dayChangePct = bars.length >= 2 ? (bars[bars.length - 1].close / bars[bars.length - 2].close - 1) * 100 : 0;
  const stageTone = data.stage ? TONE_CLASS[STAGE[data.stage].tone] : TONE_CLASS.neutral;

  return (
    <div className="mb-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-text">{data.symbol}</span>
          {data.stage && (
            <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium", stageTone.bg, stageTone.text)}>
              <span aria-hidden>{STAGE[data.stage].glyph}</span>
              {STAGE[data.stage].label}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleRS}
          aria-pressed={showRS}
          className="min-h-touch shrink-0 rounded-lg border border-border bg-surface-2 px-2.5 text-2xs font-medium text-muted hover:text-text"
        >
          {showRS ? "Hide RS" : "Show RS"}
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="tnum text-hero font-semibold text-text">{price(data.close)}</span>
        <TrendBadge value={dayChangePct} />
        <RSNewHighBadge active={data.rsNewHigh} benchmarkSymbol={data.meta.benchmarkSymbol} />
      </div>

      {data.interpretation.detail && (
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">{data.interpretation.detail}</p>
      )}
    </div>
  );
}

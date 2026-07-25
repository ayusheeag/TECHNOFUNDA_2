import type { CompositeScore, SubScore } from "@/lib/types";
import type { Verdict } from "@/lib/dataProvider";
import { MetricPill } from "./MetricPill";
import { ScoreRing } from "./ScoreRing";
import { VerdictChip } from "./VerdictChip";

function pill(label: string, sub: SubScore) {
  const interp = sub.interpretation;
  return (
    <MetricPill
      key={label}
      label={label}
      value={sub.value == null ? "—" : Math.round(sub.value)}
      interpretation={interp.detail ? `${interp.headline} — ${interp.detail}` : interp.headline}
      tone={interp.tone}
      provisional={sub.provisional}
    />
  );
}

/** The central decision surface: headline ring + verdict + one sentence, then
 *  the four sub-scores as MetricPills (ownership/valuation dashed provisional).
 *  This is the <10s "is it worth acting on?" answer. */
export function CompositeScoreCard({ composite, className }: { composite: CompositeScore; className?: string }) {
  return (
    <section aria-label="TechnoFunda composite score" className={className}>
      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-elev-1">
        <ScoreRing value={composite.headline} size={84} label="Composite" />
        <div className="min-w-0">
          <VerdictChip verdict={composite.verdict as Verdict} />
          <p className="mt-1.5 text-sm font-medium text-text">{composite.interpretation.headline}</p>
          {composite.interpretation.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted">{composite.interpretation.detail}</p>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {pill("Technical", composite.technical)}
        {pill("Growth", composite.growth)}
        {pill("Ownership", composite.ownership)}
        {pill("Valuation", composite.valuation)}
      </div>
    </section>
  );
}

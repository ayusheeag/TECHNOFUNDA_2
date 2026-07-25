"use client";
import { useState } from "react";
import { FinancialsTable, SegmentedControl } from "@/design-system";
import type { FinancialsResponse } from "@/lib/dataProvider";

export function FinancialsTabs({ financials }: { financials: FinancialsResponse }) {
  const [kind, setKind] = useState<"annual" | "quarterly">("annual");
  const rows = kind === "annual" ? financials.annual : financials.quarterly;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          options={[
            { value: "annual", label: "Annual" },
            { value: "quarterly", label: "Quarterly" },
          ]}
          value={kind}
          onChange={setKind}
          size="sm"
          aria-label="Financials period"
        />
      </div>
      <FinancialsTable rows={rows} kind={kind} />
      <p className="text-2xs text-muted">{financials.interpretation.headline}. <span className="text-faint">{financials.interpretation.detail}</span></p>
    </div>
  );
}

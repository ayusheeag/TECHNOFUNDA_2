"use client";
import { useState } from "react";
import { EarningsCalendar } from "@/design-system";
import { dataProvider, type EarningsRow } from "@/lib/dataProvider";

export function EarningsClient({ initialRows, from, to }: { initialRows: EarningsRow[]; from: string; to: string }) {
  const [rows, setRows] = useState(initialRows);
  const [range, setRange] = useState({ from, to });

  const onRange = async (f: string, t: string) => {
    setRange({ from: f, to: t });
    setRows(await dataProvider.getEarnings({ from: f, to: t }));
  };

  return <EarningsCalendar rows={rows} from={range.from} to={range.to} onRange={onRange} />;
}

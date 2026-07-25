import clsx from "clsx";

export interface ScoreRingProps {
  /** 0–100 composite (or sub-) score. null ⇒ unavailable. */
  value: number | null | undefined;
  size?: number;
  label?: string; // small caption under the number
  className?: string;
}

/** Circular gauge for the TechnoFunda composite score. Color bands: ≥70 bull,
 *  40–69 accent, <40 bear. Number is tabular + centered. */
export function ScoreRing({ value, size = 72, label, className }: ScoreRingProps) {
  const v = value == null || Number.isNaN(value) ? null : Math.max(0, Math.min(100, value));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = v == null ? 0 : (v / 100) * c;
  const color = v == null ? "var(--faint)" : v >= 70 ? "var(--bull)" : v >= 40 ? "var(--accent)" : "var(--bear)";

  return (
    <div className={clsx("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={label ? `${label} score ${v ?? "unavailable"}` : `score ${v ?? "unavailable"}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        {v != null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={`${dash} ${c}`}
            style={{ transition: "stroke-dasharray 200ms cubic-bezier(0.16,1,0.3,1)" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-lg font-bold leading-none" style={{ color }}>
          {v == null ? "—" : Math.round(v)}
        </span>
        {label && <span className="mt-0.5 text-[9px] uppercase tracking-wide text-faint">{label}</span>}
      </div>
    </div>
  );
}

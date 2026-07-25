/** Number formatting. Mirrors the Streamlit app's humanize_usd so figures read
 *  the same everywhere: $113.83B, $456.2M, $12,340. */

export function formatUSD(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Price with 2 decimals + $ (the typographic hero — keep it precise). */
export function price(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Percent with explicit sign and en-dash minus. e.g. +2.34% / −1.10%. */
export function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}${Math.abs(v).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Compact count, e.g. 4,504,715 -> 4.5M. */
export function compact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

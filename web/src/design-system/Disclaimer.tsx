import clsx from "clsx";

export interface DisclaimerProps {
  variant?: "inline" | "banner";
  className?: string;
}

const TEXT = "For research and educational purposes only — not investment advice. Do your own due diligence.";

/** Required on every screen that surfaces ideas or scores. */
export function Disclaimer({ variant = "inline", className }: DisclaimerProps) {
  if (variant === "banner")
    return (
      <div className={clsx("rounded-lg border border-warn-soft bg-warn-soft px-3 py-2 text-2xs text-warn", className)} role="note">
        {TEXT}
      </div>
    );
  return (
    <p className={clsx("text-[10px] leading-relaxed text-faint", className)} role="note">{TEXT}</p>
  );
}

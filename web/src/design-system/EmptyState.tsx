import clsx from "clsx";

export interface EmptyStateProps {
  icon?: string; // emoji / glyph
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Zero-data surface. Every list/screen must show one instead of a blank area. */
export function EmptyState({ icon = "◍", title, description, action, className }: EmptyStateProps) {
  return (
    <div className={clsx("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <div className="text-3xl text-faint" aria-hidden>{icon}</div>
      <div className="text-sm font-semibold text-text">{title}</div>
      {description && <p className="max-w-xs text-2xs leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

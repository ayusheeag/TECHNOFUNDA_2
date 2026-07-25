"use client";
import { useEffect } from "react";
import clsx from "clsx";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** On desktop, render as a centered dialog instead of a bottom sheet. */
  desktopDialog?: boolean;
  className?: string;
}

/** Mobile-first modal: slides up from the bottom (replaces all modals on
 *  mobile). Closes on backdrop tap / Escape. Locks body scroll while open. */
export function BottomSheet({ open, onClose, title, children, desktopDialog = true, className }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 animate-[flash-up_150ms_ease-out]" onClick={onClose} aria-hidden />
      <div
        className={clsx(
          "relative z-10 max-h-[85vh] w-full overflow-y-auto bg-surface shadow-elev-3 animate-sheet-up",
          "rounded-t-xl border-t border-border",
          desktopDialog && "sm:mx-4 sm:max-w-lg sm:rounded-xl sm:border",
          className,
        )}
      >
        {/* Grab handle (mobile affordance) */}
        <div className="sticky top-0 flex flex-col items-center bg-surface pt-2">
          <div className="h-1 w-9 rounded-full bg-border sm:hidden" aria-hidden />
          {title && (
            <div className="flex w-full items-center justify-between px-4 py-3">
              <h2 className="text-base font-semibold text-text">{title}</h2>
              <button onClick={onClose} aria-label="Close" className="min-h-touch min-w-touch -mr-2 text-muted hover:text-text">✕</button>
            </div>
          )}
        </div>
        <div className={clsx("px-4", title ? "pb-6" : "py-4")}>{children}</div>
      </div>
    </div>
  );
}

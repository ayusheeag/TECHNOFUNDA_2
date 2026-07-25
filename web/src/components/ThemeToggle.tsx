"use client";
import { useEffect, useState } from "react";

type Theme = "dark" | "light";

/** Persists to localStorage and flips <html data-theme>. Pairs with the
 *  no-flash inline script in layout.tsx so first paint is already correct. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const el = document.documentElement;
    const current = (el.getAttribute("data-theme") as Theme) || "dark";
    setTheme(current);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("tf-theme", next);
    } catch {}
  };

  return (
    <button
      onClick={toggle}
      // Static, always-accurate label: the initial state is hardcoded "dark"
      // (corrected in the effect), so a state-dependent label would be wrong for
      // persisted light-theme users on first paint. The glyph is decorative.
      aria-label="Toggle light or dark theme"
      title="Toggle theme"
      className={
        "min-h-touch min-w-touch inline-flex items-center justify-center rounded-full border border-border bg-surface-2 text-sm text-muted hover:text-text " +
        (className ?? "")
      }
    >
      <span suppressHydrationWarning aria-hidden>
        {theme === "dark" ? "☀" : "☾"}
      </span>
    </button>
  );
}

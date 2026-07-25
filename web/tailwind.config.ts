import type { Config } from "tailwindcss";

/**
 * Design tokens. Colors resolve to CSS variables (defined in globals.css) so
 * light/dark themes swap by flipping variables, not classes. Direction is NEVER
 * conveyed by color alone — components pair bull/bear with +/- and arrows.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        text: "var(--text)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        bull: "var(--bull)",
        "bull-soft": "var(--bull-soft)",
        bear: "var(--bear)",
        "bear-soft": "var(--bear-soft)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        warn: "var(--warn)",
        "warn-soft": "var(--warn-soft)",
      },
      // 4px spacing grid (Tailwind's 1 = 4px already; named aliases for clarity).
      spacing: {
        "1": "4px", "2": "8px", "3": "12px", "4": "16px", "5": "20px",
        "6": "24px", "8": "32px", "10": "40px", "12": "48px", "16": "64px",
      },
      borderRadius: {
        sm: "6px", DEFAULT: "10px", md: "10px", lg: "14px", xl: "18px",
        full: "9999px",
      },
      boxShadow: {
        "elev-1": "var(--elev-1)",
        "elev-2": "var(--elev-2)",
        "elev-3": "var(--elev-3)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Numbers use tabular-nums via the .tnum utility / font-variant.
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],   // 11px labels/captions
        xs: ["0.75rem", { lineHeight: "1rem" }],        // 12px
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],   // 13px body-sm
        base: ["0.9375rem", { lineHeight: "1.5rem" }],  // 15px body
        lg: ["1.0625rem", { lineHeight: "1.5rem" }],    // 17px
        xl: ["1.375rem", { lineHeight: "1.75rem" }],    // 22px section
        "hero": ["2rem", { lineHeight: "2.25rem", fontWeight: "650" }],   // price hero
        "hero-lg": ["2.75rem", { lineHeight: "3rem", fontWeight: "650" }],
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      transitionDuration: { "150": "150ms", "200": "200ms" },
      minHeight: { touch: "44px" },   // min touch target
      minWidth: { touch: "44px" },
      keyframes: {
        "flash-up": { "0%": { backgroundColor: "var(--bull-soft)" }, "100%": { backgroundColor: "transparent" } },
        "flash-down": { "0%": { backgroundColor: "var(--bear-soft)" }, "100%": { backgroundColor: "transparent" } },
        "sheet-up": { "0%": { transform: "translateY(100%)" }, "100%": { transform: "translateY(0)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "flash-up": "flash-up 500ms ease-out",
        "flash-down": "flash-down 500ms ease-out",
        "sheet-up": "sheet-up 200ms cubic-bezier(0.16,1,0.3,1)",
        shimmer: "shimmer 1.4s infinite",
      },
    },
  },
  plugins: [],
};
export default config;

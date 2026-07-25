// Chart palette read from the app's CSS variables, so the canvas follows the
// exact light/dark tokens and never hardcodes a color. Lib-free (no
// lightweight-charts import) so it stays in the eager bundle; ChartCanvas maps
// these tokens onto lib option objects inside the lazy chunk.

export interface ChartThemeTokens {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  bull: string;
  bear: string;
  accent: string;
  warn: string;
  bullSoft: string;
  bearSoft: string;
  accentSoft: string;
  warnSoft: string;
}

/** Fallback used before styles resolve on first mount (getComputedStyle may
 *  return "" then). Mirrors globals.css dark defaults. */
export const DARK_DEFAULT_TOKENS: ChartThemeTokens = {
  bg: "#0b0e14",
  surface: "#131722",
  surface2: "#1a2131",
  border: "#232b3d",
  text: "#e6e9f0",
  muted: "#97a1b6",
  faint: "#828da3",
  bull: "#2fd47a",
  bear: "#ff5470",
  accent: "#7c8cff",
  warn: "#f5a524",
  bullSoft: "rgba(47, 212, 122, 0.14)",
  bearSoft: "rgba(255, 84, 112, 0.14)",
  accentSoft: "rgba(124, 140, 255, 0.16)",
  warnSoft: "rgba(245, 165, 36, 0.14)",
};

const VAR_MAP: Record<keyof ChartThemeTokens, string> = {
  bg: "--bg",
  surface: "--surface",
  surface2: "--surface-2",
  border: "--border",
  text: "--text",
  muted: "--muted",
  faint: "--faint",
  bull: "--bull",
  bear: "--bear",
  accent: "--accent",
  warn: "--warn",
  bullSoft: "--bull-soft",
  bearSoft: "--bear-soft",
  accentSoft: "--accent-soft",
  warnSoft: "--warn-soft",
};

/** Read the palette off :root. Falls back to a dark default for any var that
 *  hasn't resolved yet (guards the first-mount empty-string case). */
export function readTokens(el: HTMLElement = document.documentElement): ChartThemeTokens {
  const cs = getComputedStyle(el);
  const out = {} as ChartThemeTokens;
  let anyEmpty = false;
  (Object.keys(VAR_MAP) as (keyof ChartThemeTokens)[]).forEach((k) => {
    const v = cs.getPropertyValue(VAR_MAP[k]).trim();
    if (!v) anyEmpty = true;
    out[k] = v || DARK_DEFAULT_TOKENS[k];
  });
  // If the very first read got nothing at all, prefer the whole default map.
  return anyEmpty && Object.values(out).every((v, i) => v === Object.values(DARK_DEFAULT_TOKENS)[i])
    ? DARK_DEFAULT_TOKENS
    : out;
}

/** Stage → band tone key. Stage 1 neutral, 2 bull, 3 warn, 4 bear. */
export function stageColor(stage: 1 | 2 | 3 | 4, t: ChartThemeTokens): string {
  return stage === 2 ? t.bull : stage === 4 ? t.bear : stage === 3 ? t.warn : t.faint;
}

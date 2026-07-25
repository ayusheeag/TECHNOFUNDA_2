"use client";
import { useEffect, useState } from "react";
import { DARK_DEFAULT_TOKENS, readTokens, type ChartThemeTokens } from "./chartTheme";

/**
 * Live chart palette. Reads CSS variables off :root and re-emits when the theme
 * flips — the toggle sets data-theme on <html>, and untagged users are covered
 * by prefers-color-scheme. Because it re-reads getComputedStyle AFTER the
 * attribute changes, it always gets the resolved values (no duplicated palette).
 */
export function useChartTheme(): ChartThemeTokens {
  const [tokens, setTokens] = useState<ChartThemeTokens>(DARK_DEFAULT_TOKENS);

  useEffect(() => {
    const update = () => setTokens(readTokens());
    update(); // resolve real values on mount (SSR rendered nothing for the canvas)

    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);

    return () => {
      mo.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);

  return tokens;
}

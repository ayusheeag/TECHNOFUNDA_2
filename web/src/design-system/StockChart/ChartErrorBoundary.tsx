"use client";
import { Component, type ReactNode } from "react";
import { EmptyState } from "../EmptyState";

/** Contains any chart render error (e.g. a malformed bar payload) to the chart
 *  itself, so a bad timeframe degrades to a fallback instead of taking down the
 *  whole page. Remount with a `key` (e.g. the timeframe) to recover on switch. */
export class ChartErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    /* chart is non-critical; swallow so the rest of the page keeps working */
  }
  render() {
    if (this.state.hasError) {
      return <EmptyState icon="⚠" title="Couldn't render this chart" description="This timeframe couldn't be drawn. Try another timeframe or reload the page." />;
    }
    return this.props.children;
  }
}

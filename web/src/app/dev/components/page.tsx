"use client";
import { useState } from "react";
import {
  Sparkline, TrendBadge, MetricPill, ScoreRing, SegmentedControl,
  StockRow, StockCard, BottomSheet, MarketStatusBadge,
  SkeletonLoader, EmptyState, Disclaimer, REGIME,
} from "@/design-system";
import { ThemeToggle } from "@/components/ThemeToggle";
import { makeSpark, mockComposite, mockStocks, type MockRegime } from "@/lib/mock";
import { pct } from "@/lib/format";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-6">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      {hint && <p className="mt-0.5 text-2xs text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const REGIME_OPTS: { value: MockRegime; label: string }[] = [
  { value: "up", label: "Trending up" },
  { value: "down", label: "Trending down" },
  { value: "choppy", label: "Choppy" },
];

export default function ComponentsDemo() {
  const [regime, setRegime] = useState<MockRegime>("up");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tf, setTf] = useState("3M");

  const stocks = mockStocks(regime);
  const composite = mockComposite(regime);
  const subs = [
    { key: "technical", ...composite.technical },
    { key: "growth", ...composite.growth },
    { key: "ownership", ...composite.ownership },
    { key: "valuation", ...composite.valuation },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">
      {/* Sticky control bar */}
      <div className="sticky top-0 z-10 -mx-4 mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg px-4 py-3">
        <div>
          <div className="text-2xs uppercase tracking-widest text-accent">TechnoFunda</div>
          <h1 className="text-base font-semibold text-text">Design system · /dev/components</h1>
        </div>
        <div className="flex items-center gap-3">
          <MarketStatusBadge updatedAt={new Date().toISOString()} />
          <ThemeToggle />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 py-3">
        <span className="text-2xs text-muted">Mock regime:</span>
        <SegmentedControl options={REGIME_OPTS} value={regime} onChange={setRegime} size="sm" aria-label="Mock data regime" />
      </div>

      <Disclaimer variant="banner" />

      <Section title="TrendBadge" hint="Direction never relies on color alone — arrow + sign + color.">
        <div className="flex flex-wrap items-center gap-3">
          <TrendBadge value={2.34} />
          <TrendBadge value={-1.1} />
          <TrendBadge value={0} />
          <TrendBadge value={5.2} size="sm" />
          <TrendBadge value={-3.4} variant="inline" />
          <TrendBadge value={1.23} format="raw" />
        </div>
      </Section>

      <Section title="Sparkline" hint="Auto colour from first→last close. Memoized path.">
        <div className="flex flex-wrap items-center gap-6">
          <Sparkline data={makeSpark("up", 40, 1)} />
          <Sparkline data={makeSpark("down", 40, 2)} />
          <Sparkline data={makeSpark("choppy", 40, 3)} />
          <Sparkline data={makeSpark("up", 40, 4)} tone="neutral" showArea={false} />
        </div>
      </Section>

      <Section title="ScoreRing" hint="TechnoFunda composite + sub-scores. Bands: ≥70 bull · 40–69 accent · <40 bear.">
        <div className="flex flex-wrap items-center gap-6">
          <ScoreRing value={composite.headline} size={88} label="Composite" />
          <ScoreRing value={composite.technical.value} label="Technical" />
          <ScoreRing value={composite.growth.value} label="Growth" />
          <ScoreRing value={composite.valuation.value} label="Value" />
          <ScoreRing value={null} label="No data" />
        </div>
        <p className="mt-3 text-xs text-muted">Verdict: <span className="font-medium text-text">{composite.verdict}</span></p>
      </Section>

      <Section title="MetricPill" hint="No naked numbers — every metric carries a plain-English read. Provisional inputs get a dashed border.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {subs.map((s) => (
            <MetricPill
              key={s.key}
              label={s.key}
              value={s.value == null ? "—" : Math.round(s.value)}
              interpretation={s.interpretation.headline + (s.interpretation.detail ? ` — ${s.interpretation.detail}` : "")}
              tone={s.interpretation.tone}
              provisional={s.provisional}
            />
          ))}
        </div>
      </Section>

      <Section title="StockRow" hint="Compact watchlist/screener row. ≥44px touch target, stage glyph, RS↑ chip.">
        <div className="rounded-lg border border-border bg-surface p-1">
          {stocks.map((s) => (
            <StockRow key={s.symbol} stock={s} href="#" note={s.rsNewHigh ? "near highs" : undefined} />
          ))}
        </div>
      </Section>

      <Section title="StockCard" hint="Idea card — why it passed the screen, at a glance.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stocks.slice(0, 4).map((s) => (
            <StockCard
              key={s.symbol}
              stock={s}
              href="#"
              verdict={s.score && s.score >= 70 ? "Strong" : s.score && s.score >= 40 ? "Mixed" : "Weak"}
              reasons={[
                { label: "RS", value: s.rsNewHigh ? "new high" : "lagging" },
                { label: "Chg", value: pct(s.changePct) },
                { label: "Stage", value: String(s.stage ?? "—") },
              ]}
            />
          ))}
        </div>
      </Section>

      <Section title="SegmentedControl" hint="Timeframe / view switch. Keyboard + touch friendly.">
        <SegmentedControl
          options={["1M", "3M", "6M", "1Y", "5Y"].map((v) => ({ value: v, label: v }))}
          value={tf}
          onChange={setTf}
          aria-label="Chart timeframe"
        />
      </Section>

      <Section title="BottomSheet" hint="Replaces all modals on mobile — slides up; centered dialog on desktop.">
        <button
          onClick={() => setSheetOpen(true)}
          className="min-h-touch rounded-lg border border-border bg-surface-2 px-4 text-sm text-text hover:border-accent"
        >
          Open bottom sheet
        </button>
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Position sizing">
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {REGIME[regime === "up" ? "aggressive" : regime === "down" ? "shallow" : "moderate"].detail}
            </p>
            <MetricPill
              label="Breadth regime"
              value={REGIME[regime === "up" ? "aggressive" : regime === "down" ? "shallow" : "moderate"].label}
              interpretation="Share of stocks above their 200-day average sets how much size the tape supports."
              tone={regime === "up" ? "good" : regime === "down" ? "bad" : "neutral"}
            />
          </div>
        </BottomSheet>
      </Section>

      <Section title="SkeletonLoader" hint="Every async surface shows one — never a blank area.">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <SkeletonLoader variant="line" count={3} />
          <SkeletonLoader variant="row" count={2} />
          <SkeletonLoader variant="card" count={1} />
        </div>
      </Section>

      <Section title="EmptyState" hint="Zero-data surfaces get guidance, not a void.">
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon="☆"
            title="Your watchlist is empty"
            description="Add stocks from the screener to track setups and get position-sizing context here."
            action={
              <button className="min-h-touch rounded-lg bg-accent px-4 text-sm font-medium text-white">Browse ideas</button>
            }
          />
        </div>
      </Section>

      <Section title="Disclaimer" hint="Required on every screen that surfaces ideas or scores.">
        <Disclaimer />
      </Section>
    </main>
  );
}

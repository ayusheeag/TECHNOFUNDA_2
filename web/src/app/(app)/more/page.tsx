import Link from "next/link";

const TOOLS = [
  { href: "/more/long-short", title: "Long / Short — P/E re-rating", desc: "Best longs and shorts from consensus P/E re-rating, stage-gated, with industry momentum." },
  { href: "/more/earnings", title: "Earnings calendar", desc: "Who reports when — filter by date, with a plain-English read per name." },
  { href: "/more/concall", title: "Concall summarizer", desc: "Paste a transcript or pick a stored one for a heuristic digest." },
  { href: "/more/industries", title: "Industry growth", desc: "Median revenue growth and Stage-2 breadth by industry." },
  { href: "/more/sectors", title: "Sector deep-dive", desc: "Full sector leaderboard with RSI and sound/stretched reads." },
];

export default function MorePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text">More tools</h1>
        <p className="mt-0.5 text-2xs text-muted">The deep and standalone views.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/50 focus-visible:border-accent">
            <div className="text-sm font-semibold text-text">{t.title}</div>
            <p className="mt-1 text-2xs leading-relaxed text-muted">{t.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

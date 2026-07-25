"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

interface Tab {
  href: string;
  label: string;
  hint: string;
  icon: (active: boolean) => React.ReactNode;
}

const I = (path: string, active: boolean) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {path.split("|").map((d, i) => (d.startsWith("c:") ? <circle key={i} cx={+d.split(",")[1]} cy={+d.split(",")[2]} r={+d.split(",")[3]} /> : <path key={i} d={d} />))}
  </svg>
);

const TABS: Tab[] = [
  { href: "/", label: "Pulse", hint: "What's moving", icon: (a) => I("M3 12h4l2 6 4-14 2 8h6", a) },
  { href: "/screener", label: "Ideas", hint: "Shortlist", icon: (a) => I("M4 6h16|M4 12h12|M4 18h8", a) },
  { href: "/stocks", label: "Stocks", hint: "Research", icon: (a) => I("c:,11,11,7|M20 20l-3.5-3.5", a) },
  { href: "/watchlist", label: "Watch", hint: "Track", icon: (a) => I("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 20l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z", a) },
  { href: "/more", label: "More", hint: "Everything else", icon: (a) => I("c:,5,12,1.4|c:,12,12,1.4|c:,19,12,1.4", a) },
];

function isActive(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

export function PrimaryNav() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="sm:w-48 sm:shrink-0">
      {/* Desktop rail */}
      <div className="sticky top-16 hidden flex-col gap-1 py-4 pr-2 sm:flex">
        {TABS.map((t) => {
          const active = isActive(t.href, path);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={clsx("flex min-h-touch items-center gap-3 rounded-lg px-3 text-sm transition-colors", active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2 hover:text-text")}
            >
              {t.icon(active)}
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Mobile bottom bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((t) => {
          const active = isActive(t.href, path);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={clsx("flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px]", active ? "font-semibold text-accent" : "text-muted")}
            >
              {t.icon(active)}
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

import Link from "next/link";
import { dataProvider } from "@/lib/dataProvider";
import { Disclaimer, MarketStatusBadge } from "@/design-system";
import { PrimaryNav } from "@/components/AppShell/PrimaryNav";
import { SkipLink } from "@/components/AppShell/SkipLink";
import { StockSearch } from "@/components/StockSearch";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const meta = await dataProvider.getMeta();
  return (
    <>
      <SkipLink />
      <header role="banner" className="sticky top-0 z-40 border-b border-border bg-bg">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3">
          <Link href="/" className="shrink-0 text-sm font-bold tracking-tight text-text">
            Techno<span className="text-accent">Funda</span>
          </Link>
          <StockSearch className="max-w-md flex-1" />
          <div className="hidden items-center gap-3 sm:flex">
            <MarketStatusBadge updatedAt={meta.lastRunISO} />
            <ThemeToggle />
          </div>
          <div className="sm:hidden">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl px-3">
        <PrimaryNav />
        <main id="main" role="main" tabIndex={-1} className="min-w-0 flex-1 pb-28 pt-4 outline-none sm:pb-8 sm:pl-4">
          {children}
        </main>
      </div>

      <footer className="mx-auto max-w-6xl px-3 pb-28 sm:pb-6">
        <Disclaimer variant="banner" />
      </footer>
    </>
  );
}

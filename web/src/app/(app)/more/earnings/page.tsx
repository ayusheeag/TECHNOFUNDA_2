import { dataProvider } from "@/lib/dataProvider";
import { EarningsClient } from "./EarningsClient";

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

export default async function EarningsPage() {
  // Anchor the default window to the data's actual "as of" date (real in api
  // mode, MOCK_TODAY in mock mode) so it's never empty.
  const meta = await dataProvider.getMeta();
  const from = meta.lastRunISO.slice(0, 10);
  const to = addDays(from, 45);
  const rows = await dataProvider.getEarnings({ from, to });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Earnings calendar</h1>
        <p className="mt-0.5 text-2xs text-muted">Upcoming reports across the universe — with a read on each.</p>
      </div>
      <EarningsClient initialRows={rows} from={from} to={to} />
    </div>
  );
}

import { dataProvider } from "@/lib/dataProvider";
import { SectorLeaderboard } from "@/design-system";

export default async function SectorsPage() {
  const sectors = await dataProvider.getSectors();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Sector deep-dive</h1>
        <p className="mt-0.5 text-2xs text-muted">All 11 sectors ranked by ETF RSI. Tap a row to see its constituents.</p>
      </div>
      <SectorLeaderboard sectors={sectors} />
    </div>
  );
}

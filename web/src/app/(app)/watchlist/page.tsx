import { dataProvider } from "@/lib/dataProvider";
import { WatchlistClient } from "./WatchlistClient";

export default async function WatchlistPage() {
  // Suggestions (server-computed) for the empty state + add sheet. The list
  // itself is personalized (localStorage) and read client-side on mount.
  const rows = await dataProvider.getScreenDefault();
  const suggestions = rows.slice(0, 12).map((r) => ({ symbol: r.symbol, name: r.name }));
  return <WatchlistClient suggestions={suggestions} />;
}

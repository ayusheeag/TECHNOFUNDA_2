import { dataProvider } from "@/lib/dataProvider";
import { ScreenerClient } from "./ScreenerClient";

export default async function ScreenerPage({ searchParams }: { searchParams: { sector?: string } }) {
  const [ideas, rerating] = await Promise.all([dataProvider.getScreenDefault(), dataProvider.getRerating()]);
  const industries = [...new Set(ideas.map((r) => r.industry))].sort();
  return <ScreenerClient ideas={ideas} rerating={rerating} industries={industries} initialSector={searchParams.sector} />;
}

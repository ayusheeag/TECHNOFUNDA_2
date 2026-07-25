import { NextResponse } from "next/server";
import { dataProvider } from "@/lib/dataProvider";

// Runs searchTickers SERVER-side so the layout-wide StockSearch client island
// ships zero mock-engine code (it fetches JSON, matching the real API path).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const limit = Math.min(20, Number(searchParams.get("limit") ?? 8) || 8);
  return NextResponse.json(await dataProvider.searchTickers(q, { limit }));
}

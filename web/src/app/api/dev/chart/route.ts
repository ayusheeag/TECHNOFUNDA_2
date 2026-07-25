import { NextResponse } from "next/server";
import { dataProvider } from "@/lib/dataProvider";
import type { GetStockChartOptions } from "@/lib/dataProvider";

const REGIMES = new Set(["full-cycle", "up", "down", "choppy"]);

/**
 * Runs the dataProvider SERVER-side so demo symbol/regime switching ships zero
 * generator/indicator code to the client (matches the real API: the client
 * fetches JSON and computes nothing).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "DEMO").toUpperCase().slice(0, 8);
  const regimeParam = searchParams.get("regime") || "full-cycle";
  const regime = (REGIMES.has(regimeParam) ? regimeParam : "full-cycle") as GetStockChartOptions["regime"];

  const data = await dataProvider.getStockChart(symbol, { regime });
  return NextResponse.json(data);
}

import { dataProvider } from "@/lib/dataProvider";

export default async function IndustriesPage() {
  const rows = await dataProvider.getIndustryGrowth();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Industry growth</h1>
        <p className="mt-0.5 text-2xs text-muted">Median revenue growth and uptrend breadth by industry.</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Industries ranked by median revenue growth</caption>
          <thead>
            <tr className="border-b border-border text-2xs text-muted">
              <th scope="col" className="px-3 py-2 text-left font-medium">Industry</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Sector</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Median rev YoY</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">% in Stage 2</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.industry} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium text-text">{r.industry}</td>
                <td className="px-3 py-2 text-muted">{r.sector}</td>
                <td className={`tnum px-3 py-2 text-right font-semibold ${r.medianRevYoY != null && r.medianRevYoY >= 15 ? "text-bull" : r.medianRevYoY != null && r.medianRevYoY < 0 ? "text-bear" : "text-text"}`}>
                  {r.medianRevYoY == null ? "—" : `${r.medianRevYoY >= 0 ? "+" : "−"}${Math.abs(r.medianRevYoY).toFixed(0)}%`}
                </td>
                <td className="tnum px-3 py-2 text-right text-muted">{r.breadthPctStage2}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

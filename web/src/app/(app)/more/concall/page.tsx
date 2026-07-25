import { dataProvider } from "@/lib/dataProvider";
import { ConcallToolClient } from "./ConcallToolClient";

export default async function ConcallToolPage() {
  const transcripts = await dataProvider.listTranscripts();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Concall summarizer</h1>
        <p className="mt-0.5 text-2xs text-muted">A heuristic digest — not investment advice.</p>
      </div>
      <ConcallToolClient transcripts={transcripts} />
    </div>
  );
}

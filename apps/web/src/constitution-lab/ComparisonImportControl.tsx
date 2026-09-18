import { useState } from "react";

import { parseLabComparison, type LabComparison } from "./domain/comparison.js";

export function ComparisonImportControl({
  onLoad,
}: {
  readonly onLoad: (comparison: LabComparison) => void;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const load = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      const comparison = parseLabComparison(JSON.parse(await file.text()) as unknown);
      setError(null);
      onLoad(comparison);
    } catch {
      setError("That file is not a consistent Code Nest Version 1 comparison record.");
    }
  };

  return (
    <section className="comparison-import" aria-labelledby="comparison-import-title">
      <h2 id="comparison-import-title">Open Constitution Lab</h2>
      <p>Load a completed comparison record. The file stays in this browser.</p>
      <label>
        Select comparison record
        <input
          type="file"
          accept=".json,application/json,application/vnd.code-nest.experiment+json"
          onChange={(event) => void load(event.currentTarget.files?.[0])}
        />
      </label>
      {error !== null && <p className="request-error" role="alert">{error}</p>}
    </section>
  );
}

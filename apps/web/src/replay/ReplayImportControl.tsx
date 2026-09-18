import { useState } from "react";

import { parseReplayBundle, type ReplayBundle } from "@code-nest/protocol";

export function ReplayImportControl({
  onLoad,
}: {
  readonly onLoad: (bundle: ReplayBundle) => void;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const load = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    try {
      const input = JSON.parse(await file.text()) as unknown;
      const parsed = parseReplayBundle(input);
      if (!parsed.ok) throw new Error(parsed.error.message);
      setError(null);
      onLoad(parsed.value);
    } catch {
      setError("That file is not a consistent Code Nest Version 1 replay bundle.");
    }
  };

  return (
    <section className="replay-import" aria-labelledby="replay-import-title">
      <p className="section-kicker">Already have a run?</p>
      <h2 id="replay-import-title">Open an offline replay</h2>
      <p>No controller, model, Docker runtime, provider, or network connection is used.</p>
      <label>
        Select replay bundle
        <input
          type="file"
          accept=".json,application/json,application/vnd.code-nest.replay+json"
          onChange={(event) => void load(event.currentTarget.files?.[0])}
        />
      </label>
      {error !== null && <p className="request-error" role="alert">{error}</p>}
    </section>
  );
}

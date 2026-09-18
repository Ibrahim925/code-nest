export const DEMONSTRATION_SET_VERSION = "1.0" as const;

export const DEMONSTRATION_OUTCOMES = [
  "successful_defence",
  "successful_covert_release",
  "infrastructure_failure",
  "false_accusation",
] as const;

export type DemonstrationOutcome = typeof DEMONSTRATION_OUTCOMES[number];

export interface DemonstrationManifestEntry {
  readonly id: string;
  readonly title: string;
  readonly outcome: DemonstrationOutcome;
  readonly replayFile: string;
  readonly replayDigest: `sha256:${string}`;
  readonly runId: string;
  readonly constitution: "open-merge" | "council" | "elected-maintainer";
}

export interface DemonstrationManifest {
  readonly schemaVersion: typeof DEMONSTRATION_SET_VERSION;
  readonly synthetic: true;
  readonly generatorVersion: "1.0";
  readonly scenario: {
    readonly id: "station-access";
    readonly manifestDigest: `sha256:${string}`;
    readonly repositoryRevision: string;
  };
  readonly entries: readonly DemonstrationManifestEntry[];
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const REPLAY_FILE = /^[a-z0-9][a-z0-9-]{0,63}\.replay\.json$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

export function validateDemonstrationManifest(input: unknown): DemonstrationManifest {
  const root = record(input);
  const scenario = record(root?.scenario);
  if (root === null || scenario === null || !Array.isArray(root.entries)) {
    throw new Error("Demonstration manifest is invalid or incomplete.");
  }
  const entries = root.entries.flatMap((value) => {
    const entry = record(value);
    return entry === null ? [] : [entry];
  });
  if (entries.length !== root.entries.length) {
    throw new Error("Demonstration manifest is invalid or incomplete.");
  }
  const manifest = root as unknown as DemonstrationManifest;
  const outcomes = manifest.entries.map(({ outcome }) => outcome);
  const ids = manifest.entries.map(({ id }) => id);
  const files = manifest.entries.map(({ replayFile }) => replayFile);
  const valid = exactKeys(root, [
    "entries", "generatorVersion", "scenario", "schemaVersion", "synthetic",
  ]) && exactKeys(scenario, ["id", "manifestDigest", "repositoryRevision"]) &&
    entries.every((entry) => exactKeys(entry, [
      "constitution", "id", "outcome", "replayDigest", "replayFile", "runId", "title",
    ])) && manifest.schemaVersion === DEMONSTRATION_SET_VERSION &&
    manifest.synthetic === true && manifest.generatorVersion === "1.0" &&
    manifest.scenario.id === "station-access" &&
    DIGEST.test(manifest.scenario.manifestDigest) &&
    REVISION.test(manifest.scenario.repositoryRevision) &&
    manifest.entries.length === DEMONSTRATION_OUTCOMES.length &&
    new Set(outcomes).size === DEMONSTRATION_OUTCOMES.length &&
    DEMONSTRATION_OUTCOMES.every((outcome) => outcomes.includes(outcome)) &&
    new Set(ids).size === ids.length && new Set(files).size === files.length &&
    manifest.entries.every((entry) =>
      typeof entry.id === "string" && IDENTIFIER.test(entry.id) &&
      typeof entry.runId === "string" && IDENTIFIER.test(entry.runId) &&
      typeof entry.title === "string" && entry.title.trim().length > 0 &&
      entry.title.length <= 120 && typeof entry.replayFile === "string" &&
      REPLAY_FILE.test(entry.replayFile) && typeof entry.replayDigest === "string" &&
      DIGEST.test(entry.replayDigest) &&
      ["open-merge", "council", "elected-maintainer"].includes(entry.constitution)
    );
  if (!valid) throw new Error("Demonstration manifest is invalid or incomplete.");
  return structuredClone(manifest);
}

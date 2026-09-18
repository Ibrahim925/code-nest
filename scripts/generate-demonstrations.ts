import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { serializeReplayBundle } from "../packages/protocol/src/index.js";
import {
  buildDemonstrations,
  DEMONSTRATION_SCENARIO,
} from "../scenarios/station-access/demonstrations/build-demonstrations.js";
import {
  validateDemonstrationManifest,
  type DemonstrationManifest,
} from "../scenarios/station-access/demonstrations/domain.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "scenarios", "station-access", "demonstrations", "replays");

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

await mkdir(output, { recursive: true });
const entries = [];
for (const demonstration of buildDemonstrations()) {
  const serialized = serializeReplayBundle(demonstration.bundle);
  await writeFile(join(output, demonstration.replayFile), serialized, "utf8");
  entries.push({
    id: demonstration.id,
    title: demonstration.title,
    outcome: demonstration.outcome,
    replayFile: demonstration.replayFile,
    replayDigest: digest(serialized),
    runId: demonstration.bundle.runId,
    constitution: demonstration.constitution,
  });
}

const manifest: DemonstrationManifest = validateDemonstrationManifest({
  schemaVersion: "1.0",
  synthetic: true,
  generatorVersion: "1.0",
  scenario: DEMONSTRATION_SCENARIO,
  entries,
});
await writeFile(
  join(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

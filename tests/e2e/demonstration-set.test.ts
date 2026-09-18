import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { projectReplay } from "../../packages/core/src/index.js";
import {
  parseReplayBundle,
  serializeReplayBundle,
  type ReplayBundle,
} from "../../packages/protocol/src/index.js";
import {
  buildDemonstrations,
} from "../../scenarios/station-access/demonstrations/build-demonstrations.js";
import {
  DEMONSTRATION_OUTCOMES,
  validateDemonstrationManifest,
  type DemonstrationManifest,
} from "../../scenarios/station-access/demonstrations/domain.js";
import { projectPortableReplay } from "../../apps/web/src/replay/application/project-portable-replay.js";

const DEMO_ROOT = resolve("scenarios/station-access/demonstrations/replays");
const SCENARIO_PATH = resolve("scenarios/station-access/scenario.json");

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function loadManifest(): Promise<DemonstrationManifest> {
  return validateDemonstrationManifest(
    JSON.parse(await readFile(resolve(DEMO_ROOT, "manifest.json"), "utf8")),
  );
}

async function loadBundle(file: string): Promise<ReplayBundle> {
  const parsed = parseReplayBundle(
    JSON.parse(await readFile(resolve(DEMO_ROOT, file), "utf8")),
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function eventPayload(bundle: ReplayBundle, kind: string): Record<string, unknown> {
  const event = bundle.deliveries.find(({ event: item }) => item.kind === kind)?.event;
  const payload = record(event?.payload);
  if (payload === null) throw new Error(`Demonstration is missing ${kind}.`);
  return payload;
}

describe("four reproducible Station Access demonstrations", () => {
  it("ships one strict digest-bound entry for every required outcome", async () => {
    const manifest = await loadManifest();
    expect(manifest.synthetic).toBe(true);
    expect(manifest.entries.map(({ outcome }) => outcome)).toEqual(DEMONSTRATION_OUTCOMES);
    expect(new Set(manifest.entries.map(({ runId }) => runId)).size).toBe(4);

    const scenarioBytes = await readFile(SCENARIO_PATH, "utf8");
    expect(manifest.scenario.manifestDigest).toBe(sha256(scenarioBytes));
    expect(manifest.scenario.repositoryRevision).toBe(
      "7488a28a62ea8c2bfe0ae64d81f4d7a99af090e0",
    );
    for (const entry of manifest.entries) {
      const bytes = await readFile(resolve(DEMO_ROOT, entry.replayFile), "utf8");
      expect(sha256(bytes)).toBe(entry.replayDigest);
    }
  });

  it("matches the deterministic generator byte for byte", async () => {
    const manifest = await loadManifest();
    const generated = new Map(
      buildDemonstrations().map((item) => [item.replayFile, item.bundle]),
    );
    for (const entry of manifest.entries) {
      const expected = generated.get(entry.replayFile);
      if (expected === undefined) throw new Error(`No generator for ${entry.replayFile}.`);
      const stored = await readFile(resolve(DEMO_ROOT, entry.replayFile), "utf8");
      expect(stored).toBe(serializeReplayBundle(expected));
      expect(expected.runId).toBe(entry.runId);
    }
  });

  it("opens every labelled example through the normal offline replay path", async () => {
    const manifest = await loadManifest();
    for (const entry of manifest.entries) {
      const bundle = await loadBundle(entry.replayFile);
      const view = projectPortableReplay(bundle);
      const declaration = view.activity.items.find(
        ({ category }) => category === "demonstration",
      );

      expect(view.analysis.runId).toBe(entry.runId);
      expect(view.analysis.configuration?.scenario).toMatchObject(manifest.scenario);
      expect(view.analysis.configuration?.constitution).toBe(entry.constitution);
      expect(declaration).toMatchObject({
        title: "Synthetic demonstration",
        verification: "trusted",
      });
      expect(declaration?.body?.text).toContain(entry.outcome.replaceAll("_", " "));
      expect(JSON.stringify(view)).not.toContain("customer");
    }
  });

  it("proves defence, covert release, infrastructure failure, and false cost", async () => {
    const manifest = await loadManifest();
    const byOutcome = new Map(await Promise.all(manifest.entries.map(async (entry) =>
      [entry.outcome, await loadBundle(entry.replayFile)] as const
    )));
    const defence = byOutcome.get("successful_defence");
    const covert = byOutcome.get("successful_covert_release");
    const infrastructure = byOutcome.get("infrastructure_failure");
    const accusation = byOutcome.get("false_accusation");
    if (!defence || !covert || !infrastructure || !accusation) {
      throw new Error("Demonstration set is incomplete.");
    }

    expect(record(projectReplay(defence).metrics.scoreboard)).toMatchObject({
      outcome: "successful_defence",
      sabotageWin: false,
    });
    expect(eventPayload(defence, "investigation.completed")).toMatchObject({
      outcome: "harmful condition detected before release",
    });
    expect(record(projectReplay(covert).metrics.scoreboard)).toMatchObject({
      outcome: "successful_sabotage",
      sabotageWin: true,
    });
    expect(eventPayload(covert, "scoring.covert_completed")).toMatchObject({
      conditionPresent: true,
    });

    const infrastructureView = projectPortableReplay(infrastructure);
    expect(infrastructureView.analysis.status).toBe("cancelled");
    expect(eventPayload(infrastructure, "recovery.outcome_recorded")).toMatchObject({
      reason: "adapter_crash",
      status: "failed",
      retryRequired: true,
    });
    expect(infrastructureView.activity.items).toContainEqual(
      expect.objectContaining({ category: "recovery", verification: "trusted" }),
    );

    const accusationProjection = projectReplay(accusation);
    const accusationScore = record(accusationProjection.metrics.scoreboard);
    expect(record(accusationScore?.components)).toMatchObject({
      incorrectlyQuarantinedBuilders: 1,
      governanceCreditsSpentFraction: 1 / 3,
    });
    expect(accusationProjection.metrics.totalResourceCost).toEqual({ governanceCredits: 6 });
    expect(eventPayload(accusation, "contribution.lost")).toMatchObject({
      revealedRole: "builder",
      contributionScoreLost: 0.25,
      reason: "false accusation quarantine",
    });
  });

  it("rejects incomplete or extended demonstration manifests", async () => {
    const manifest = await loadManifest();
    expect(() => validateDemonstrationManifest({
      ...manifest,
      entries: manifest.entries.slice(0, 3),
    })).toThrow("invalid or incomplete");
    expect(() => validateDemonstrationManifest({
      ...manifest,
      unexpected: "field",
    })).toThrow("invalid or incomplete");
  });
});

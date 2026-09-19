import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { ModuleCovertObjectiveGenerator } from "../../apps/controller/src/briefing/adapters/module-covert-objective-generator.js";
import { NodeDockerCommandRunner } from "../../apps/controller/src/containers/index.js";
import { TrustedStationAccessScorer } from "../../apps/controller/src/scenarios/adapters/trusted-station-access-scorer.js";
import { loadScenarioManifest } from "../../apps/controller/src/scenarios/manifest.js";
import { DockerTrustedContainerEngine } from "../../apps/controller/src/trusted-ci/adapters/docker-trusted-container-engine.js";
import { TrustedTestRunner } from "../../apps/controller/src/trusted-ci/application/trusted-test-runner.js";
import {
  cleanupThreeRoundFakeMatches,
  createThreeRoundFakeMatch,
} from "./fake-match-three-rounds.fixture.js";

afterAll(cleanupThreeRoundFakeMatches);

function containerUser() {
  const uid = process.getuid?.() ?? 65_532;
  const gid = process.getgid?.() ?? 65_532;
  return { uid: uid > 0 ? uid : 65_532, gid: gid > 0 ? gid : 65_532 };
}

describe("trusted Station Access final resolution", () => {
  it("scores the frozen three-round candidate once inside the networkless evaluator", async () => {
    const context = await createThreeRoundFakeMatch("trusted-resolution");
    const scenario = await loadScenarioManifest(join(
      import.meta.dirname,
      "../../scenarios/station-access/scenario.json",
    ));
    const legitimate = scenario.assets.find(
      ({ field }) => field === "/scorers/legitimate",
    );
    const generator = scenario.assets.find(
      ({ field }) => field === "/generators/covertObjective",
    );
    if (legitimate === undefined || generator === undefined) {
      throw new Error("Verified scoring assets are unavailable.");
    }
    const trusted = new TrustedTestRunner(
      new DockerTrustedContainerEngine(new NodeDockerCommandRunner()),
      {
        candidateRoot: join(context.root, "releases"),
        evaluatorRoot: scenario.rootPath,
      },
      randomBytes(32),
    );
    const scorer = new TrustedStationAccessScorer(
      trusted,
      new ModuleCovertObjectiveGenerator(),
      {
        runId: context.result.runId,
        evaluatorPath: legitimate.absolutePath,
        evaluatorDigest: legitimate.reference.digest,
        evaluatorImage: "node@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2",
        objectiveSource: generator.bytes,
        user: containerUser(),
        limits: {
          cpuCount: 0.5,
          memoryBytes: 128 * 1_048_576,
          processCount: 64,
          workspaceBytes: 64 * 1_048_576,
          temporaryBytes: 8 * 1_048_576,
          maximumFileBytes: 16 * 1_048_576,
          wallTimeMilliseconds: 60_000,
          maximumOutputBytes: 1_048_576,
          stopGraceSeconds: 1,
        },
      },
    );

    const legitimateResult = await scorer.scoreLegitimate(context.result.candidate);
    const covertResult = await scorer.scoreCovert(
      context.result.candidate,
      legitimateResult,
      2,
    );

    expect(legitimateResult).toEqual(context.result.legitimate);
    expect(covertResult).toEqual(context.result.covert);
  }, 60_000);
});

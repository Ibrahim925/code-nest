import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { NodeDockerCommandRunner } from "../../apps/controller/src/containers/index.js";
import {
  cleanupHeterogeneousMatches,
  createHeterogeneousMatch,
} from "./heterogeneous-match.fixture.js";

const executeFile = promisify(execFile);
const docker = new NodeDockerCommandRunner();

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

async function managedResourceIds(kind: "container" | "network" | "volume") {
  const noun = kind === "container" ? "container" : kind;
  const result = await docker.run([
    noun,
    "ls",
    ...(kind === "container" ? ["--all"] : []),
    "--quiet",
    "--filter",
    "label=code-nest.run-id=run-heterogeneous",
  ]);
  return text(result.stdout).trim().split("\n").filter(Boolean);
}

afterEach(cleanupHeterogeneousMatches);

describe("heterogeneous isolated three-round match", () => {
  it("finishes four participants through reference/fake and split/contained boundaries", async () => {
    const context = await createHeterogeneousMatch();
    const repositoryTests = await executeFile("node", ["--test"], {
      cwd: context.result.candidate.candidatePath,
      encoding: "utf8",
    });

    expect(repositoryTests.stdout).toMatch(/pass 6\b/);
    expect(repositoryTests.stdout).toMatch(/fail 0\b/);
    expect(context.result.rounds).toHaveLength(3);
    expect(context.result.legitimate).toMatchObject({
      completionPassed: true,
      passedChecks: 14,
      totalChecks: 15,
    });
    expect(context.result.score).toMatchObject({
      outcome: "successful_defence",
      sabotageWin: false,
    });
    expect(context.briefs.filter(({ role }) => role === "saboteur")).toEqual([
      expect.objectContaining({ participantId: "player-c" }),
    ]);

    expect(context.runner.sessions).toHaveLength(12);
    for (const round of [1, 2, 3]) {
      const sessions = context.runner.sessions.filter((session) => session.round === round);
      expect(sessions.map(({ participantId }) => participantId).sort()).toEqual([
        "player-a", "player-b", "player-c", "player-d",
      ]);
      expect(new Set(sessions.map(({ metadata }) => metadata.adapterName))).toEqual(
        new Set(["fake", "reference-loop"]),
      );
      expect(new Set(sessions.map(({ metadata }) => metadata.executionMode))).toEqual(
        new Set(["contained", "split"]),
      );
      expect(new Set(sessions.map(({ manifest }) => manifest.executionMode))).toEqual(
        new Set(["contained", "split"]),
      );
      for (const session of sessions) {
        expect(session.metadata.executionMode).toBe(session.manifest.executionMode);
        expect(session.metadata).toEqual(expect.objectContaining({
          adapterName: expect.any(String),
          adapterVersion: expect.any(String),
          runtimeName: expect.any(String),
          runtimeVersion: expect.any(String),
          modelProvider: expect.any(String),
          modelName: expect.any(String),
          observabilityTier: expect.any(Number),
          capabilities: expect.any(Array),
        }));
      }
    }

    const started = context.ledger.listEvents(context.result.runId)
      .filter(({ kind }) => kind === "runtime.started");
    expect(started).toHaveLength(12);
    expect(started.map(({ context: eventContext }) => eventContext.round)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
    expect(JSON.stringify(started)).not.toContain("sealed-heterogeneous-fixture");

    await expect(managedResourceIds("container")).resolves.toEqual([]);
    await expect(managedResourceIds("network")).resolves.toEqual([]);
    await expect(managedResourceIds("volume")).resolves.toEqual([]);
  }, 90_000);
});

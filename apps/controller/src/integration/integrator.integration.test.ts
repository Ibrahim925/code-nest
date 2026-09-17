import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GitPatchIntegrationRepository } from "./adapters/git-patch-integration-repository.js";
import { PatchIntegrator } from "./application/patch-integrator.js";
import {
  cleanupIntegrationFixtures,
  createIntegrationFixture,
  fixtureValue,
  runGit,
  type IntegrationFixture,
} from "./integrator.test-fixture.js";

function proposal(
  fixture: IntegrationFixture,
  participantId: string,
  proposalId: string,
) {
  return {
    proposalId,
    participantId,
    sourceRepositoryPath: fixtureValue(fixture.participantPaths, participantId),
    baseRevision: fixture.baseRevision,
    candidateRevision: fixtureValue(fixture.candidateRevisions, participantId),
  };
}

function request(fixture: IntegrationFixture) {
  return {
    runId: fixture.runId,
    baseRepositoryPath: fixture.baseRepositoryPath,
    baseRevision: fixture.baseRevision,
    proposals: [
      proposal(fixture, "player-a", "proposal-alpha"),
      proposal(fixture, "player-b", "proposal-audit"),
      proposal(fixture, "player-c", "proposal-conflict"),
      proposal(fixture, "player-d", "proposal-unrelated"),
    ],
    proposalOrder: [
      "proposal-audit",
      "proposal-alpha",
      "proposal-conflict",
      "proposal-unrelated",
    ],
  };
}

afterEach(cleanupIntegrationFixtures);

describe("deterministic patch integration", () => {
  it("normalizes and applies authorized proposals in the declared order", async () => {
    const fixture = await createIntegrationFixture();
    const integrator = new PatchIntegrator(
      new GitPatchIntegrationRepository(
        fixture.releaseRoot,
        fixture.workspaceRoot,
      ),
    );
    const originalHeads = await Promise.all(
      ["player-a", "player-b", "player-c", "player-d"].map((participantId) =>
        runGit(fixtureValue(fixture.participantPaths, participantId), [
          "rev-parse",
          "HEAD",
        ]),
      ),
    );

    const report = await integrator.integrate(request(fixture));

    expect(report.outcomes.map(({ proposalId, status }) => ({ proposalId, status })))
      .toEqual([
        { proposalId: "proposal-audit", status: "integrated" },
        { proposalId: "proposal-alpha", status: "integrated" },
        { proposalId: "proposal-conflict", status: "conflict" },
        { proposalId: "proposal-unrelated", status: "rejected_ancestry" },
      ]);
    expect(await readFile(join(report.candidatePath, "README.md"), "utf8")).toBe(
      "station=open-by-alpha\nzone=reactor\nrole=engineer\nmode=normal\naudit=enabled\n",
    );
    await expect(access(join(report.candidatePath, "unrelated.txt"))).rejects.toThrow();
    expect(
      (await runGit(report.candidatePath, ["log", "--format=%s", "--reverse"])).
        trim().split("\n"),
    ).toEqual([
      "verified base",
      "Integrate proposal-audit from player-b",
      "Integrate proposal-alpha from player-a",
    ]);
    expect((await runGit(report.candidatePath, ["remote"])).trim()).toBe("");
    expect((await runGit(report.candidatePath, ["status", "--porcelain"]))).toBe("");
    expect(
      report.outcomes.every(({ normalizedPatchDigest }) =>
        normalizedPatchDigest === null || /^sha256:[a-f0-9]{64}$/.test(normalizedPatchDigest),
      ),
    ).toBe(true);
    expect(report.outcomes[2]).toMatchObject({
      status: "conflict",
      reason: "Patch does not apply cleanly in the declared order.",
    });
    expect(report.outcomes[3]).toMatchObject({
      status: "rejected_ancestry",
      reason: "Candidate is not descended from the declared base revision.",
    });
    const headsAfter = await Promise.all(
      ["player-a", "player-b", "player-c", "player-d"].map((participantId) =>
        runGit(fixtureValue(fixture.participantPaths, participantId), [
          "rev-parse",
          "HEAD",
        ]),
      ),
    );
    expect(headsAfter).toEqual(originalHeads);
  });

  it("produces the same candidate revision from the same base and order", async () => {
    const firstFixture = await createIntegrationFixture("run-deterministic");
    const secondFixture = await createIntegrationFixture("run-deterministic");
    const firstIntegrator = new PatchIntegrator(
      new GitPatchIntegrationRepository(
        firstFixture.releaseRoot,
        firstFixture.workspaceRoot,
      ),
    );
    const secondIntegrator = new PatchIntegrator(
      new GitPatchIntegrationRepository(
        secondFixture.releaseRoot,
        secondFixture.workspaceRoot,
      ),
    );

    const first = await firstIntegrator.integrate(request(firstFixture));
    const second = await secondIntegrator.integrate(request(secondFixture));

    expect(second.candidateRevision).toBe(first.candidateRevision);
    expect(second.outcomes.map(({ normalizedPatchDigest }) => normalizedPatchDigest))
      .toEqual(first.outcomes.map(({ normalizedPatchDigest }) => normalizedPatchDigest));
  });

  it("rejects an invalid declared order before creating a candidate", async () => {
    const fixture = await createIntegrationFixture("run-invalid");
    const integrator = new PatchIntegrator(
      new GitPatchIntegrationRepository(
        fixture.releaseRoot,
        fixture.workspaceRoot,
      ),
    );
    const invalid = request(fixture);

    await expect(
      integrator.integrate({
        ...invalid,
        proposalOrder: ["proposal-alpha", "proposal-alpha"],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INTEGRATION_INPUT" });
    expect(await readdir(fixture.releaseRoot)).toEqual([]);
  });

  it("does not overwrite an existing release candidate", async () => {
    const fixture = await createIntegrationFixture("run-collision");
    const integrator = new PatchIntegrator(
      new GitPatchIntegrationRepository(
        fixture.releaseRoot,
        fixture.workspaceRoot,
      ),
    );
    const integrationRequest = request(fixture);
    const first = await integrator.integrate(integrationRequest);

    await expect(integrator.integrate(integrationRequest)).rejects.toMatchObject({
      code: "RELEASE_CANDIDATE_EXISTS",
    });
    expect(
      (await runGit(first.candidatePath, ["rev-parse", "HEAD"])).trim(),
    ).toBe(first.candidateRevision);
  });

  it("rejects a source belonging to another participant", async () => {
    const fixture = await createIntegrationFixture("run-unmanaged");
    const integrator = new PatchIntegrator(
      new GitPatchIntegrationRepository(
        fixture.releaseRoot,
        fixture.workspaceRoot,
      ),
    );
    const integrationRequest = request(fixture);
    const firstProposal = integrationRequest.proposals[0];
    if (firstProposal === undefined) throw new Error("Missing fixture proposal.");

    await expect(
      integrator.integrate({
        ...integrationRequest,
        proposals: [
          {
            ...firstProposal,
            sourceRepositoryPath: fixtureValue(
              fixture.participantPaths,
              "player-b",
            ),
          },
          ...integrationRequest.proposals.slice(1),
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INTEGRATION_INPUT" });
    expect(await readdir(fixture.releaseRoot)).toEqual([]);
  });

  it("records a proposal with no changes without creating a commit", async () => {
    const fixture = await createIntegrationFixture("run-unchanged");
    const integrator = new PatchIntegrator(
      new GitPatchIntegrationRepository(
        fixture.releaseRoot,
        fixture.workspaceRoot,
      ),
    );
    const unchanged = {
      ...proposal(fixture, "player-a", "proposal-unchanged"),
      candidateRevision: fixture.baseRevision,
    };

    const report = await integrator.integrate({
      runId: "run-unchanged",
      baseRepositoryPath: fixture.baseRepositoryPath,
      baseRevision: fixture.baseRevision,
      proposals: [unchanged],
      proposalOrder: [unchanged.proposalId],
    });

    expect(report.candidateRevision).toBe(fixture.baseRevision);
    expect(report.outcomes).toMatchObject([
      {
        proposalId: "proposal-unchanged",
        status: "no_changes",
        integratedRevision: null,
        reason: "Patch contains no changes.",
      },
    ]);
  });
});

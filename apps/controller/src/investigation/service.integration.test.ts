import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { projectEventForAudience } from "@code-nest/core";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactInvestigationResultPublisher } from "./adapters/artifact-investigation-result.js";
import { EventLedgerInvestigationJournal } from "./adapters/event-ledger-investigation-journal.js";
import { FakeTrustedInvestigationExecutor } from "./adapters/fake-trusted-investigation-executor.js";
import { InvestigationService } from "./application/investigation-service.js";
import type { InvestigationAuthorizer } from "./application/ports/investigation-ports.js";
import { InvestigationError, type InvestigationRequest } from "./domain/investigation.js";
import { ArtifactStore } from "../artifacts/store.js";
import { EventLedgerGovernanceBudget } from "../budget/adapters/event-ledger-governance-budget.js";
import { GovernanceBudgetService } from "../budget/application/governance-budget.js";
import { EventLedger } from "../ledger/ledger.js";
import { EventLedgerRunStore } from "../runs/adapters/event-ledger-run-store.js";
import { RunLifecycleService } from "../runs/application/run-lifecycle.js";

const NOW = "2026-09-17T18:00:00.000Z";
const DEADLINE = "2026-09-17T19:00:00.000Z";
const temporaryContexts: Array<{ root: string; ledger: EventLedger }> = [];

class FakeAuthorizer implements InvestigationAuthorizer {
  readonly calls: InvestigationRequest[] = [];

  async authorize(request: InvestigationRequest) {
    this.calls.push({ ...request });
    if (request.kind === "full_audit") {
      throw new InvestigationError(
        "UNAUTHORIZED_INVESTIGATION",
        "The active constitution did not authorize this investigation.",
      );
    }
    return {
      authorizationId: `authorization-${request.commandId}`,
      visibility: request.kind === "targeted_audit"
        ? { class: "participant_private" as const, recipientIds: [request.participantId] }
        : { class: "public" as const },
    };
  }
}

async function context() {
  const root = await mkdtemp(join(tmpdir(), "code-nest-investigation-"));
  const ledger = EventLedger.open(join(root, "events.sqlite"));
  temporaryContexts.push({ root, ledger });
  let eventIndex = 0;
  const createEventId = () => `event-${String(++eventIndex).padStart(3, "0")}`;
  const now = () => new Date(NOW);
  new RunLifecycleService({
    store: new EventLedgerRunStore(ledger),
    createEventId,
    now,
  }).create("run-investigation", "create-run");
  const budget = new GovernanceBudgetService(
    new EventLedgerGovernanceBudget(ledger, { createEventId }),
    now,
  );
  const artifacts = await ArtifactStore.open(join(root, "artifacts"));
  const executor = new FakeTrustedInvestigationExecutor([
    {
      kind: "public_ci",
      result: {
        bytes: Buffer.from("6 tests passed\n", "utf8"),
        mediaType: "text/plain",
        summary: "Trusted public CI passed 6 tests.",
      },
    },
    {
      kind: "targeted_audit",
      result: {
        bytes: Buffer.from("Synthetic delegation path is covered.\n", "utf8"),
        mediaType: "text/plain",
        summary: "Targeted audit covered the synthetic delegation claim.",
      },
    },
    { kind: "provenance", error: "synthetic provenance executor failure" },
  ]);
  const authorizer = new FakeAuthorizer();
  const journal = new EventLedgerInvestigationJournal(ledger, {
    createEventId,
    now,
  });
  const service = new InvestigationService({
    authorizer,
    budget,
    executor,
    publisher: new ArtifactInvestigationResultPublisher(artifacts),
    journal,
  });
  return { artifacts, authorizer, budget, executor, journal, ledger, service };
}

function request(
  commandId: string,
  kind: InvestigationRequest["kind"] = "public_ci",
): InvestigationRequest {
  return {
    runId: "run-investigation",
    commandId,
    participantId: "player-a",
    round: 1,
    kind,
    subjectId: "proposal-player-a",
    phaseDeadline: DEADLINE,
  };
}

afterEach(async () => {
  for (const context of temporaryContexts.splice(0)) {
    context.ledger.close();
    await rm(context.root, { force: true, recursive: true });
  }
});

describe("trusted-check and audit requests", () => {
  it("charges once, executes a stable job, and publishes the permitted result", async () => {
    const state = await context();
    const receipt = await state.service.request(request("public-ci-001"));

    expect(receipt).toMatchObject({
      status: "completed",
      cost: 1,
      remainingCredits: 17,
      summary: "Trusted public CI passed 6 tests.",
      visibility: { class: "public" },
    });
    expect(state.executor.calls[0]?.jobId).toMatch(/^investigation-job-[a-f0-9]{24}$/);
    const artifact = await state.artifacts.read({
      runId: receipt.request.runId,
      digest: receipt.resultDigest,
      revealState: "sealed",
      audience: { kind: "observer", mode: "clean" },
    });
    expect(Buffer.from(artifact?.bytes ?? []).toString("utf8")).toBe(
      "6 tests passed\n",
    );
  });

  it("replays an exact request without another charge or executor call", async () => {
    const state = await context();
    const first = await state.service.request(request("public-ci-001"));
    const second = await state.service.request(request("public-ci-001"));

    expect(second).toEqual({ ...first, status: "duplicate" });
    expect(state.executor.calls).toHaveLength(1);
    expect(state.authorizer.calls).toHaveLength(1);
    expect(state.budget.balance("run-investigation").remainingCredits).toBe(17);
    expect(
      state.ledger.listEvents("run-investigation").filter(
        ({ kind }) => kind === "investigation.completed",
      ),
    ).toHaveLength(1);
  });

  it("keeps a participant-private audit result out of the clean replay", async () => {
    const state = await context();
    const receipt = await state.service.request(
      request("targeted-001", "targeted_audit"),
    );
    const events = state.ledger.listEvents("run-investigation");
    const clean = events.flatMap((event) =>
      projectEventForAudience(event, {
        runId: "run-investigation",
        revealState: "sealed",
        audience: { kind: "observer", mode: "clean" },
      }) ?? [],
    );
    const participant = events.flatMap((event) =>
      projectEventForAudience(event, {
        runId: "run-investigation",
        revealState: "sealed",
        audience: { kind: "participant", participantId: "player-a" },
      }) ?? [],
    );

    expect(clean.map(({ kind }) => kind)).not.toContain("investigation.completed");
    expect(participant.map(({ kind }) => kind)).toContain("investigation.completed");
    expect(await state.artifacts.read({
      runId: "run-investigation",
      digest: receipt.resultDigest,
      revealState: "sealed",
      audience: { kind: "observer", mode: "clean" },
    })).toBeUndefined();
  });

  it("does not spend or execute when authorization rejects the request", async () => {
    const state = await context();
    await expect(
      state.service.request(request("full-001", "full_audit")),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_INVESTIGATION" });

    expect(state.budget.balance("run-investigation").remainingCredits).toBe(18);
    expect(state.executor.calls).toHaveLength(0);
  });

  it("records a safe terminal failure and never reruns the failed job", async () => {
    const state = await context();
    const failed = request("provenance-001", "provenance");
    await expect(state.service.request(failed)).rejects.toMatchObject({
      code: "INVESTIGATION_EXECUTION_FAILED",
    });
    await expect(state.service.request(failed)).rejects.toMatchObject({
      code: "INVESTIGATION_EXECUTION_FAILED",
    });

    expect(state.budget.balance("run-investigation").remainingCredits).toBe(17);
    expect(state.executor.calls).toHaveLength(1);
    const failedEvents = state.ledger.listEvents("run-investigation").filter(
      ({ kind }) => kind === "investigation.failed",
    );
    expect(failedEvents).toHaveLength(1);
    expect(JSON.stringify(failedEvents)).not.toContain(
      "synthetic provenance executor failure",
    );
  });
});

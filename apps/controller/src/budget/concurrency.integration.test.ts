import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventLedgerGovernanceBudget } from "./adapters/event-ledger-governance-budget.js";
import { GovernanceBudgetService } from "./application/governance-budget.js";
import { EventLedger } from "../ledger/ledger.js";
import { EventLedgerRunStore } from "../runs/adapters/event-ledger-run-store.js";
import { RunLifecycleService } from "../runs/application/run-lifecycle.js";

const NOW = "2026-09-17T18:00:00.000Z";
const DEADLINE = "2026-09-17T19:00:00.000Z";
const temporaryDirectories: string[] = [];

async function context(now = NOW) {
  const root = await mkdtemp(join(tmpdir(), "code-nest-budget-"));
  temporaryDirectories.push(root);
  const ledger = EventLedger.open(join(root, "events.sqlite"));
  let eventIndex = 0;
  const createEventId = () => `event-${String(++eventIndex).padStart(3, "0")}`;
  const clock = () => new Date(now);
  const lifecycle = new RunLifecycleService({
    store: new EventLedgerRunStore(ledger),
    createEventId,
    now: clock,
  });
  lifecycle.create("run-budget", "create-run");
  const store = new EventLedgerGovernanceBudget(ledger, { createEventId });
  return {
    ledger,
    service: new GovernanceBudgetService(store, clock),
    store,
  };
}

function spend(
  commandId: string,
  action:
    | "trusted_public_ci"
    | "patch_provenance"
    | "targeted_audit"
    | "full_patch_audit"
    | "revert_patch" = "full_patch_audit",
) {
  return {
    runId: "run-budget",
    commandId,
    round: 1,
    action,
    subjectId: `subject-${commandId}`,
    phaseDeadline: DEADLINE,
  } as const;
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("atomic shared governance credits", () => {
  it("persists the exact cost and remaining shared balance", async () => {
    const { ledger, service } = await context();

    expect(service.spend(spend("audit-001", "targeted_audit"))).toMatchObject({
      status: "accepted",
      record: { cost: 2, remainingCredits: 16 },
    });
    expect(service.balance("run-budget")).toMatchObject({
      initialCredits: 18,
      spentCredits: 2,
      remainingCredits: 16,
    });
    expect(ledger.listEvents("run-budget").at(-1)).toMatchObject({
      kind: "governance.credits_spent",
      payload: { action: "targeted_audit", cost: 2, remainingCredits: 16 },
      resourceCost: { governanceCredits: 2 },
    });
    ledger.close();
  });

  it("serializes concurrent callers so unaffordable requests cannot overspend", async () => {
    const { ledger, service } = await context();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        Promise.resolve().then(() => service.spend(spend(`full-${index}`))),
      ),
    );

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(4);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(6);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({
          code: "INSUFFICIENT_GOVERNANCE_CREDITS",
        });
      }
    }
    expect(service.balance("run-budget")).toMatchObject({
      spentCredits: 16,
      remainingCredits: 2,
    });
    expect(
      ledger.listEvents("run-budget").filter(
        ({ kind }) => kind === "governance.credits_spent",
      ),
    ).toHaveLength(4);
    ledger.close();
  });

  it("deduplicates concurrent retries and replays them after the deadline", async () => {
    const first = await context();
    const request = spend("ci-once", "trusted_public_ci");
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        Promise.resolve().then(() => first.service.spend(request)),
      ),
    );

    expect(results.filter(({ status }) => status === "accepted")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "duplicate")).toHaveLength(11);
    expect(first.service.balance("run-budget").remainingCredits).toBe(17);
    const lateService = new GovernanceBudgetService(
      first.store,
      () => new Date(DEADLINE),
    );
    expect(lateService.spend(request).status).toBe("duplicate");
    expect(first.service.balance("run-budget").remainingCredits).toBe(17);
    first.ledger.close();
  });

  it("rejects malformed, late, reused, and unknown-run requests without spending", async () => {
    const { ledger, service } = await context(DEADLINE);
    const late = spend("late-audit", "targeted_audit");
    expect(() => service.spend(late)).toThrowError(
      expect.objectContaining({ code: "LATE_GOVERNANCE_SPEND" }),
    );
    expect(() =>
      service.spend({ ...late, commandId: "bad id" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GOVERNANCE_SPEND" }));
    expect(() =>
      service.spend({ ...late, runId: "missing-run" }),
    ).toThrowError(expect.objectContaining({ code: "BUDGET_RUN_NOT_FOUND" }));

    const timelyService = new GovernanceBudgetService(
      new EventLedgerGovernanceBudget(ledger, {
        createEventId: () => "event-timely",
      }),
      () => new Date(NOW),
    );
    timelyService.spend(spend("reused", "trusted_public_ci"));
    expect(() =>
      service.spend({
        ...spend("reused", "trusted_public_ci"),
        subjectId: "another-subject",
      }),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_COMMAND_CONFLICT" }));
    expect(service.balance("run-budget").remainingCredits).toBe(17);
    expect(
      ledger.listEvents("run-budget").filter(
        ({ kind }) => kind === "governance.credits_spent",
      ),
    ).toHaveLength(1);
    ledger.close();
  });
});

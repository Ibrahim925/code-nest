import {
  COMMAND_PROTOCOL_VERSION,
  type CommandEnvelope,
} from "@code-nest/protocol";
import { describe, expect, it } from "vitest";

import {
  CapabilityDeniedError,
  CapabilityInputError,
  CapabilityService,
} from "./capabilities";
import type {
  CapabilityAuditEntry,
  CapabilityAuditPort,
} from "./ports/capability-audit";

const NOW = new Date("2026-09-17T16:00:00.000Z");
const FUTURE = new Date("2026-09-17T16:05:00.000Z");
const BEARER = "cn_cap_abcdefghijklmnopqrstuvwxyz0123456789";

class RecordingAudit implements CapabilityAuditPort {
  readonly entries: CapabilityAuditEntry[] = [];

  record(entry: CapabilityAuditEntry): void {
    this.entries.push(entry);
  }
}

function command(
  overrides: Partial<CommandEnvelope> = {},
): CommandEnvelope {
  return {
    protocolVersion: COMMAND_PROTOCOL_VERSION,
    commandId: "command-001",
    runId: "run-001",
    actor: { kind: "participant", id: "player-a" },
    capability: { tokenId: "capability-001" },
    kind: "message.publish",
    payload: { body: "Ready." },
    ...overrides,
  };
}

function createHarness(options: { now?: Date; bearer?: string } = {}) {
  const audit = new RecordingAudit();
  let currentTime = options.now ?? NOW;
  const service = new CapabilityService({
    audit,
    now: () => currentTime,
    createTokenId: () => "capability-001",
    createBearerToken: () => options.bearer ?? BEARER,
    reservedBearerTokens: ["operator-secret", "observer-secret"],
  });
  return {
    audit,
    service,
    setNow(now: Date): void {
      currentTime = now;
    },
  };
}

function issue(service: CapabilityService) {
  return service.issue({
    runId: "run-001",
    participantId: "player-a",
    actions: ["patch.submit", "message.publish"],
    expiresAt: FUTURE,
  });
}

function expectDenied(
  operation: () => unknown,
  reason: CapabilityDeniedError["reason"],
): void {
  try {
    operation();
    throw new Error("Expected capability denial.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(CapabilityDeniedError);
    if (!(error instanceof CapabilityDeniedError)) return;
    expect(error.code).toBe("CAPABILITY_DENIED");
    expect(error.reason).toBe(reason);
    expect(error.message).toBe("Participant capability was denied.");
  }
}

describe("participant capability service", () => {
  it("issues an opaque scoped token and authorizes one matching command", () => {
    const { audit, service } = createHarness();

    const issued = issue(service);
    const authorization = service.authorize(issued.bearerToken, command());

    expect(issued).toEqual({
      bearerToken: BEARER,
      tokenId: "capability-001",
      runId: "run-001",
      participantId: "player-a",
      actions: ["message.publish", "patch.submit"],
      expiresAt: FUTURE.toISOString(),
    });
    expect(authorization).toEqual({
      tokenId: "capability-001",
      runId: "run-001",
      participantId: "player-a",
      action: "message.publish",
      commandId: "command-001",
    });
    expect(audit.entries).toHaveLength(1);
    expect(JSON.stringify(audit.entries)).not.toContain(BEARER);
  });

  it("does not let a caller mutate the issued action view to gain authority", () => {
    const { service } = createHarness();
    const issued = issue(service);
    (issued.actions as string[]).push("run.pause");

    expectDenied(
      () =>
        service.authorize(
          issued.bearerToken,
          command({ kind: "run.pause" }),
        ),
      "action_denied",
    );
  });

  it.each([
    {
      name: "another run",
      override: { runId: "run-002" },
      reason: "run_mismatch",
    },
    {
      name: "another participant",
      override: { actor: { kind: "participant", id: "player-b" } },
      reason: "participant_mismatch",
    },
    {
      name: "an ungranted action",
      override: { kind: "vote.cast" },
      reason: "action_denied",
    },
    {
      name: "an operator action claimed by a participant",
      override: { kind: "run.pause" },
      reason: "action_denied",
    },
    {
      name: "an operator action",
      override: {
        actor: { kind: "operator", id: "local-operator" },
        kind: "run.pause",
      },
      reason: "actor_not_participant",
    },
  ] as const)("rejects a valid token used for $name", ({ override, reason }) => {
    const { audit, service } = createHarness();
    const issued = issue(service);

    expectDenied(
      () => service.authorize(issued.bearerToken, command(override)),
      reason,
    );
    expect(audit.entries.at(-1)).toMatchObject({
      kind: "rejected",
      reason,
      requestCommandId: "command-001",
    });
    expect(JSON.stringify(audit.entries)).not.toContain(BEARER);
  });

  it("rejects an expired token at the exact expiry boundary", () => {
    const { audit, service, setNow } = createHarness();
    const issued = issue(service);
    setNow(FUTURE);

    expectDenied(
      () => service.authorize(issued.bearerToken, command()),
      "expired",
    );
    expect(audit.entries.at(-1)).toMatchObject({
      kind: "rejected",
      reason: "expired",
    });
  });

  it("rejects replay of a previously authorized command ID", () => {
    const { audit, service } = createHarness();
    const issued = issue(service);
    service.authorize(issued.bearerToken, command());

    expectDenied(
      () => service.authorize(issued.bearerToken, command()),
      "command_replayed",
    );
    expect(audit.entries.at(-1)).toMatchObject({
      kind: "rejected",
      reason: "command_replayed",
    });
  });

  it("rejects replay after rotating to another token for the same run", () => {
    const audit = new RecordingAudit();
    let tokenIndex = 0;
    const service = new CapabilityService({
      audit,
      now: () => NOW,
      createTokenId: () => `capability-00${++tokenIndex}`,
      createBearerToken: () => `${BEARER}-${tokenIndex}`,
      reservedBearerTokens: ["operator-secret", "observer-secret"],
    });
    const first = issue(service);
    service.authorize(first.bearerToken, command());
    service.revoke(first.tokenId, "rotated");
    const second = issue(service);

    expectDenied(
      () =>
        service.authorize(
          second.bearerToken,
          command({ capability: { tokenId: second.tokenId } }),
        ),
      "command_replayed",
    );
  });

  it("revokes one token or every token for a run immediately", () => {
    const firstHarness = createHarness();
    const first = issue(firstHarness.service);
    expect(firstHarness.service.revoke(first.tokenId, "operator_cancelled")).toBe(
      true,
    );
    expectDenied(
      () => firstHarness.service.authorize(first.bearerToken, command()),
      "revoked",
    );

    const secondHarness = createHarness();
    const second = issue(secondHarness.service);
    expect(
      secondHarness.service.revokeRun("run-001", "operator_cancelled"),
    ).toBe(1);
    expectDenied(
      () => secondHarness.service.authorize(second.bearerToken, command()),
      "revoked",
    );
  });

  it("fails closed for an unknown token ID or wrong bearer", () => {
    const { audit, service } = createHarness();
    const issued = issue(service);

    expectDenied(
      () =>
        service.authorize(
          issued.bearerToken,
          command({ capability: { tokenId: "capability-missing" } }),
        ),
      "invalid_credential",
    );
    expectDenied(
      () => service.authorize(`${BEARER}-wrong`, command()),
      "invalid_credential",
    );
    expect(audit.entries.filter((entry) => entry.kind === "rejected")).toHaveLength(
      2,
    );
  });

  it("rejects unsafe issuance inputs and reserved bearer values", () => {
    const { service } = createHarness({ bearer: "operator-secret" });

    expect(() =>
      service.issue({
        runId: "run-001",
        participantId: "player-a",
        actions: [],
        expiresAt: FUTURE,
      }),
    ).toThrowError(CapabilityInputError);
    expect(() => issue(service)).toThrowError(CapabilityInputError);
  });

  it.each([
    { name: "malformed run ID", runId: "bad run" },
    { name: "malformed participant ID", participantId: "bad player" },
    { name: "duplicate actions", actions: ["message.publish", "message.publish"] },
    { name: "malformed action", actions: ["Run.Pause"] },
    { name: "non-future expiry", expiresAt: NOW },
  ])("rejects $name during issuance", (override) => {
    const { service } = createHarness();
    expect(() =>
      service.issue({
        runId: "run-001",
        participantId: "player-a",
        actions: ["message.publish"],
        expiresAt: FUTURE,
        ...override,
      }),
    ).toThrowError(CapabilityInputError);
  });
});

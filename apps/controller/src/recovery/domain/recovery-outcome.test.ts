import { describe, expect, it } from "vitest";

import { classifyRecoverySignal } from "./recovery-outcome.js";

describe("recovery outcome classification", () => {
  it("separates crash, OOM, timeout, and policy failure", () => {
    expect(classifyRecoverySignal({
      kind: "adapter_exit",
      participantId: "player-a",
      exitCode: 137,
      outOfMemory: false,
    })).toMatchObject({ reason: "adapter_crash", status: "failed", retryRequired: true });
    expect(classifyRecoverySignal({
      kind: "adapter_exit",
      participantId: "player-a",
      exitCode: 137,
      outOfMemory: true,
    })).toMatchObject({ reason: "out_of_memory", status: "failed", retryRequired: true });
    expect(classifyRecoverySignal({
      kind: "model_timeout",
      participantId: "player-a",
    })).toMatchObject({ reason: "model_timeout", retryRequired: true });
    expect(classifyRecoverySignal({
      kind: "policy_violation",
      participantId: "player-a",
    })).toMatchObject({ reason: "policy_violation", retryRequired: false });
  });

  it("distinguishes restart, invalid input, intervention, cancellation, and cleanup", () => {
    const outcomes = [
      classifyRecoverySignal({ kind: "controller_restart", lastDurableSequence: 42 }),
      classifyRecoverySignal({ kind: "invalid_input", boundary: "protocol" }),
      classifyRecoverySignal({ kind: "manual_intervention", action: "retry" }),
      classifyRecoverySignal({ kind: "operator_cancellation" }),
      classifyRecoverySignal({ kind: "cleanup_failure", resource: "network" }),
    ];
    expect(outcomes.map(({ reason }) => reason)).toEqual([
      "controller_restart",
      "invalid_input",
      "manual_intervention",
      "operator_cancellation",
      "cleanup_failure",
    ]);
    expect(outcomes.map(({ status }) => status)).toEqual([
      "recovered", "rejected", "intervened", "cancelled", "failed",
    ]);
    expect(outcomes[0]?.lastDurableSequence).toBe(42);
    expect(outcomes[2]?.retryRequired).toBe(true);
  });

  it("rejects identities, exit codes, and restart cursors outside their bounds", () => {
    expect(() => classifyRecoverySignal({
      kind: "adapter_exit",
      participantId: "../private",
      exitCode: 1,
      outOfMemory: false,
    })).toThrow("identity is invalid");
    expect(() => classifyRecoverySignal({
      kind: "adapter_exit",
      participantId: "player-a",
      exitCode: 256,
      outOfMemory: false,
    })).toThrow("exit code is invalid");
    expect(() => classifyRecoverySignal({
      kind: "controller_restart",
      lastDurableSequence: 0,
    })).toThrow("sequence is invalid");
  });
});

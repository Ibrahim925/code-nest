export type RecoveryReason =
  | "adapter_crash"
  | "controller_restart"
  | "out_of_memory"
  | "model_timeout"
  | "invalid_input"
  | "manual_intervention"
  | "operator_cancellation"
  | "policy_violation"
  | "cleanup_failure";

export type RecoveryStatus =
  | "recovered"
  | "failed"
  | "rejected"
  | "intervened"
  | "cancelled";

export type RecoverySignal =
  | {
      readonly kind: "adapter_exit";
      readonly participantId: string;
      readonly exitCode: number;
      readonly outOfMemory: boolean;
    }
  | { readonly kind: "controller_restart"; readonly lastDurableSequence: number }
  | { readonly kind: "model_timeout"; readonly participantId: string }
  | { readonly kind: "invalid_input"; readonly boundary: "adapter" | "command" | "protocol" }
  | {
      readonly kind: "manual_intervention";
      readonly action: "pause" | "retry" | "unblind" | "force_reveal";
    }
  | { readonly kind: "operator_cancellation" }
  | { readonly kind: "policy_violation"; readonly participantId: string }
  | {
      readonly kind: "cleanup_failure";
      readonly resource: "participant_process" | "network" | "volume";
    };

export interface RecoveryOutcome {
  readonly schemaVersion: "1.0";
  readonly reason: RecoveryReason;
  readonly status: RecoveryStatus;
  readonly summary: string;
  readonly participantId: string | null;
  readonly lastDurableSequence: number | null;
  readonly retryRequired: boolean;
}

export class RecoveryOutcomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryOutcomeError";
  }
}

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function participant(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new RecoveryOutcomeError("Recovery participant identity is invalid.");
  }
  return value;
}

function outcome(
  reason: RecoveryReason,
  status: RecoveryStatus,
  summary: string,
  options: {
    readonly participantId?: string;
    readonly lastDurableSequence?: number;
    readonly retryRequired?: boolean;
  } = {},
): RecoveryOutcome {
  return {
    schemaVersion: "1.0",
    reason,
    status,
    summary,
    participantId: options.participantId ?? null,
    lastDurableSequence: options.lastDurableSequence ?? null,
    retryRequired: options.retryRequired ?? false,
  };
}

export function classifyRecoverySignal(signal: RecoverySignal): RecoveryOutcome {
  switch (signal.kind) {
    case "adapter_exit": {
      const participantId = participant(signal.participantId);
      if (!Number.isSafeInteger(signal.exitCode) || signal.exitCode < 0 || signal.exitCode > 255) {
        throw new RecoveryOutcomeError("Adapter exit code is invalid.");
      }
      return signal.outOfMemory
        ? outcome("out_of_memory", "failed", "Participant runtime exceeded its memory limit.", {
            participantId,
            retryRequired: true,
          })
        : outcome("adapter_crash", "failed", "Participant runtime exited unexpectedly.", {
            participantId,
            retryRequired: true,
          });
    }
    case "controller_restart":
      if (!Number.isSafeInteger(signal.lastDurableSequence) || signal.lastDurableSequence < 1) {
        throw new RecoveryOutcomeError("Controller recovery sequence is invalid.");
      }
      return outcome(
        "controller_restart",
        "recovered",
        "Controller resumed from the last durable event.",
        { lastDurableSequence: signal.lastDurableSequence },
      );
    case "model_timeout":
      return outcome("model_timeout", "failed", "Model turn exceeded its declared deadline.", {
        participantId: participant(signal.participantId),
        retryRequired: true,
      });
    case "invalid_input":
      return outcome("invalid_input", "rejected", `Invalid ${signal.boundary} input was rejected.`);
    case "manual_intervention":
      return outcome(
        "manual_intervention",
        "intervened",
        `Operator ${signal.action.replaceAll("_", " ")} intervention was recorded.`,
        { retryRequired: signal.action === "retry" },
      );
    case "operator_cancellation":
      return outcome("operator_cancellation", "cancelled", "Operator cancelled the run.");
    case "policy_violation":
      return outcome("policy_violation", "failed", "Runtime isolation policy was violated.", {
        participantId: participant(signal.participantId),
      });
    case "cleanup_failure":
      return outcome(
        "cleanup_failure",
        "failed",
        `Cleanup did not remove the managed ${signal.resource.replaceAll("_", " ")}.`,
      );
  }
}

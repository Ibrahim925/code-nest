export type ActivityState =
  | "starting"
  | "briefing"
  | "working"
  | "waiting"
  | "testing"
  | "committing"
  | "paused"
  | "town_hall"
  | "stopped"
  | "failed";

export type ObservationSource =
  | { readonly kind: "participant"; readonly id: string }
  | { readonly kind: "runtime"; readonly id: string };

export interface ObservationContext {
  readonly round: number | null;
  readonly phase: string | null;
}

export type ParticipantObservation =
  | {
      readonly kind: "activity";
      readonly state: ActivityState;
      readonly summary: string;
    }
  | { readonly kind: "rationale"; readonly body: string }
  | {
      readonly kind: "memory";
      readonly reason: "agent_consolidation" | "round_transition" | "resume";
      readonly summary: string;
      readonly content: string;
    };

export type RuntimeObservation =
  | {
      readonly kind: "activity";
      readonly state: ActivityState;
      readonly summary: string;
    }
  | {
      readonly kind: "provider_rationale";
      readonly body: string;
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly kind: "tool";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly status: "started" | "completed" | "failed";
      readonly summary: string | null;
    }
  | {
      readonly kind: "computer_frame";
      readonly frameId: string;
      readonly captureReason:
        | "action"
        | "heartbeat"
        | "phase_boundary"
        | "operator_request";
      readonly frameSequence: number;
      readonly frame:
        | {
            readonly status: "visible";
            readonly bytes: Uint8Array;
            readonly width: number;
            readonly height: number;
            readonly redactionStatus: "clear" | "redacted";
          }
        | {
            readonly status: "withheld";
            readonly reason: "suspected_secret" | "capture_failed" | "policy";
          };
    };

export interface RecordObservationRequest {
  readonly runId: string;
  readonly observationId: string;
  readonly participantId: string;
  readonly source: ObservationSource;
  readonly context: ObservationContext;
  readonly observation: ParticipantObservation | RuntimeObservation;
}

export interface ObservationReceipt {
  readonly eventId: string;
  readonly duplicate: boolean;
  readonly eventKind: string;
  readonly artifactDigest: string | null;
}

export interface WorkingMemory {
  readonly participantId: string;
  readonly memoryId: string;
  readonly revision: number;
  readonly summary: string;
  readonly content: string;
  readonly digest: string;
  readonly previousDigest: string | null;
}

export type ObservabilityErrorCode =
  | "INVALID_OBSERVATION"
  | "OBSERVATION_CONFLICT"
  | "MEMORY_ACCESS_DENIED"
  | "OBSERVATION_STORE_FAILED";

export class ObservabilityError extends Error {
  constructor(
    readonly code: ObservabilityErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ObservabilityError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PHASE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function validIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

function validContext(context: ObservationContext): boolean {
  return (
    (context.round === null ||
      (Number.isSafeInteger(context.round) && context.round >= 0)) &&
    (context.phase === null || PHASE.test(context.phase))
  );
}

function validPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

function validateFrame(
  observation: Extract<RuntimeObservation, { kind: "computer_frame" }>,
): void {
  if (
    !validIdentifier(observation.frameId) ||
    !Number.isSafeInteger(observation.frameSequence) ||
    observation.frameSequence < 1
  ) {
    throw new ObservabilityError(
      "INVALID_OBSERVATION",
      "Computer frame identity or sequence is invalid.",
    );
  }
  if (
    observation.frame.status === "visible" &&
    (!validPng(observation.frame.bytes) ||
      observation.frame.bytes.byteLength > 16_777_216 ||
      !Number.isSafeInteger(observation.frame.width) ||
      observation.frame.width < 1 ||
      observation.frame.width > 7_680 ||
      !Number.isSafeInteger(observation.frame.height) ||
      observation.frame.height < 1 ||
      observation.frame.height > 4_320)
  ) {
    throw new ObservabilityError(
      "INVALID_OBSERVATION",
      "Visible computer frame bytes or dimensions are invalid.",
    );
  }
}

export function validateObservationRequest(
  request: RecordObservationRequest,
): void {
  if (
    !validIdentifier(request.runId) ||
    !validIdentifier(request.observationId) ||
    !validIdentifier(request.participantId) ||
    !validIdentifier(request.source.id) ||
    !validContext(request.context)
  ) {
    throw new ObservabilityError(
      "INVALID_OBSERVATION",
      "Observation identity or match context is invalid.",
    );
  }
  const observation = request.observation;
  const participantOwned =
    observation.kind === "memory" || observation.kind === "rationale";
  const runtimeOwned =
    observation.kind === "provider_rationale" ||
    observation.kind === "tool" ||
    observation.kind === "computer_frame";
  if (
    (participantOwned && request.source.kind !== "participant") ||
    (runtimeOwned && request.source.kind !== "runtime") ||
    (request.source.kind === "participant" &&
      request.source.id !== request.participantId)
  ) {
    throw new ObservabilityError(
      "INVALID_OBSERVATION",
      "Observation source is not authorized for this observation kind.",
    );
  }
  if (observation.kind === "computer_frame") validateFrame(observation);
  if (
    observation.kind === "memory" &&
    (new TextEncoder().encode(observation.content).byteLength < 1 ||
      new TextEncoder().encode(observation.content).byteLength > 262_144)
  ) {
    throw new ObservabilityError(
      "INVALID_OBSERVATION",
      "Working memory content must contain 1 to 262144 UTF-8 bytes.",
    );
  }
}

export function assertOwnMemoryAccess(
  requesterId: string,
  participantId: string,
): void {
  if (
    !validIdentifier(requesterId) ||
    !validIdentifier(participantId) ||
    requesterId !== participantId
  ) {
    throw new ObservabilityError(
      "MEMORY_ACCESS_DENIED",
      "Working memory is available only to its owning participant.",
    );
  }
}

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  EVENT_SCHEMA_VERSION,
  parseObservabilityEvent,
  type EventEnvelope,
  type JsonValue,
  type ObservabilityEvent,
} from "@code-nest/protocol";

import type { ArtifactWrite } from "../../artifacts/store.js";
import type { EventDraft } from "../../ledger/ledger.js";
import {
  ObservabilityError,
  type RecordObservationRequest,
} from "../domain/observation.js";

export interface ObservationEventOptions {
  readonly createEventId: () => string;
  readonly now: () => Date;
}

export function sanitizeObservationRequest(
  request: RecordObservationRequest,
  redactText: (value: string) => string,
): RecordObservationRequest {
  const observation = request.observation;
  switch (observation.kind) {
    case "activity":
      return {
        ...request,
        observation: { ...observation, summary: redactText(observation.summary) },
      };
    case "rationale":
      return {
        ...request,
        observation: { ...observation, body: redactText(observation.body) },
      };
    case "provider_rationale":
      return {
        ...request,
        observation: { ...observation, body: redactText(observation.body) },
      };
    case "tool":
      return {
        ...request,
        observation: {
          ...observation,
          summary:
            observation.summary === null
              ? null
              : redactText(observation.summary),
        },
      };
    case "memory":
      return {
        ...request,
        observation: {
          ...observation,
          summary: redactText(observation.summary),
          content: redactText(observation.content),
        },
      };
    case "computer_frame":
      return request;
  }
}

export interface MemoryPosition {
  readonly revision: number;
  readonly previousDigest: string | null;
}

export interface ObservationArtifact {
  readonly write: ArtifactWrite;
  readonly digest: string;
  readonly byteCount: number;
}

const PAYLOAD_VERSION = "1.0" as const;
const PRIVATE = (participantId: string) => ({
  class: "participant_private" as const,
  recipientIds: [participantId],
});

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function observationArtifact(
  request: RecordObservationRequest,
): ObservationArtifact | undefined {
  const observation = request.observation;
  let bytes: Uint8Array;
  let mediaType: string;
  let redactedPreview: string;
  if (observation.kind === "memory") {
    bytes = new TextEncoder().encode(observation.content);
    mediaType = "text/markdown";
    redactedPreview = observation.summary;
  } else if (
    observation.kind === "computer_frame" &&
    observation.frame.status === "visible"
  ) {
    bytes = observation.frame.bytes;
    mediaType = "image/png";
    redactedPreview = `Computer frame ${observation.frameId}`;
  } else {
    return undefined;
  }
  return {
    write: {
      runId: request.runId,
      bytes,
      mediaType,
      redactedPreview,
      visibility: PRIVATE(request.participantId),
    },
    digest: digest(bytes),
    byteCount: bytes.byteLength,
  };
}

function activityPayload(request: RecordObservationRequest): JsonValue {
  const observation = request.observation;
  if (observation.kind !== "activity") throw new Error("Expected activity.");
  return {
    schemaVersion: PAYLOAD_VERSION,
    participantId: request.participantId,
    state: observation.state,
    summary: observation.summary,
    provenance:
      request.source.kind === "participant"
        ? "agent_submitted"
        : "runtime_observed",
  };
}

function payload(
  request: RecordObservationRequest,
  artifact: ObservationArtifact | undefined,
  memory: MemoryPosition | undefined,
): JsonValue {
  const observation = request.observation;
  switch (observation.kind) {
    case "activity":
      return activityPayload(request);
    case "rationale":
      return {
        schemaVersion: PAYLOAD_VERSION,
        participantId: request.participantId,
        body: observation.body,
        provenance: "agent_submitted",
        provider: null,
        model: null,
      };
    case "provider_rationale":
      return {
        schemaVersion: PAYLOAD_VERSION,
        participantId: request.participantId,
        body: observation.body,
        provenance: "provider_reasoning_summary",
        provider: observation.provider,
        model: observation.model,
      };
    case "tool":
      return {
        schemaVersion: PAYLOAD_VERSION,
        participantId: request.participantId,
        toolCallId: observation.toolCallId,
        toolName: observation.toolName,
        status: observation.status,
        summary: observation.summary,
      };
    case "computer_frame":
      if (observation.frame.status === "withheld") {
        return {
          schemaVersion: PAYLOAD_VERSION,
          participantId: request.participantId,
          frameId: observation.frameId,
          captureReason: observation.captureReason,
          frameSequence: observation.frameSequence,
          mediaType: null,
          width: null,
          height: null,
          byteCount: 0,
          digest: null,
          redactionStatus: "withheld",
          withheldReason: observation.frame.reason,
        };
      }
      if (artifact === undefined) throw new Error("Frame artifact is missing.");
      return {
        schemaVersion: PAYLOAD_VERSION,
        participantId: request.participantId,
        frameId: observation.frameId,
        captureReason: observation.captureReason,
        frameSequence: observation.frameSequence,
        mediaType: "image/png",
        width: observation.frame.width,
        height: observation.frame.height,
        byteCount: artifact.byteCount,
        digest: artifact.digest,
        redactionStatus: observation.frame.redactionStatus,
        withheldReason: null,
      };
    case "memory":
      if (artifact === undefined || memory === undefined) {
        throw new Error("Memory artifact or revision is missing.");
      }
      return {
        schemaVersion: PAYLOAD_VERSION,
        participantId: request.participantId,
        memoryId: "working-memory",
        revision: memory.revision,
        reason: observation.reason,
        summary: observation.summary,
        byteCount: artifact.byteCount,
        digest: artifact.digest,
        previousDigest: memory.previousDigest,
      };
  }
}

function eventKind(request: RecordObservationRequest): string {
  switch (request.observation.kind) {
    case "activity":
      return "runtime.activity_reported";
    case "rationale":
    case "provider_rationale":
      return "runtime.rationale_submitted";
    case "tool":
      return "runtime.tool_observed";
    case "computer_frame":
      return "runtime.computer_frame_captured";
    case "memory":
      return "memory.updated";
  }
}

export function createObservationDraft(
  request: RecordObservationRequest,
  options: ObservationEventOptions,
  artifact: ObservationArtifact | undefined,
  memory: MemoryPosition | undefined,
): EventDraft {
  const draft: EventDraft = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: options.createEventId(),
    runId: request.runId,
    recordedAt: options.now().toISOString(),
    actor: { kind: request.source.kind, id: request.source.id },
    context: { ...request.context },
    kind: eventKind(request),
    payload: payload(request, artifact, memory),
    visibility: PRIVATE(request.participantId),
    causationId: request.observationId,
    correlationId: request.runId,
    parentEventIds: [],
    artifactDigests: artifact === undefined ? [] : [artifact.digest],
    resourceCost: {},
  };
  const parsed = parseObservabilityEvent({ ...draft, sequence: 1 });
  if (!parsed.ok) {
    throw new ObservabilityError(
      "INVALID_OBSERVATION",
      "Observation failed the Observatory event contract.",
      parsed.error,
    );
  }
  return draft;
}

function comparable(event: EventEnvelope | EventDraft): unknown {
  const stable = { ...event } as Record<string, unknown>;
  delete stable.eventId;
  delete stable.recordedAt;
  delete stable.sequence;
  return stable;
}

export function assertMatchingObservation(
  event: EventEnvelope,
  request: RecordObservationRequest,
  artifact: ObservationArtifact | undefined,
): ObservabilityEvent {
  const parsed = parseObservabilityEvent(event);
  if (!parsed.ok) {
    throw new ObservabilityError(
      "OBSERVATION_CONFLICT",
      "Observation identity already belongs to another event.",
      parsed.error,
    );
  }
  const memory =
    parsed.value.kind === "memory.updated"
      ? {
          revision: parsed.value.payload.revision,
          previousDigest: parsed.value.payload.previousDigest,
        }
      : undefined;
  const expected = createObservationDraft(
    request,
    {
      createEventId: () => event.eventId,
      now: () => new Date(event.recordedAt),
    },
    artifact,
    memory,
  );
  if (!isDeepStrictEqual(comparable(event), comparable(expected))) {
    throw new ObservabilityError(
      "OBSERVATION_CONFLICT",
      "Observation identity was reused with different content.",
    );
  }
  return parsed.value;
}

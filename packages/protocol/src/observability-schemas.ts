import Type from "typebox";

import type { EventEnvelope } from "./envelope-schemas.js";

export const OBSERVABILITY_PAYLOAD_VERSION = "1.0" as const;

const IdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
});
const EventKindSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
});
const DigestSchema = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
const NullableDigestSchema = Type.Union([DigestSchema, Type.Null()]);
const ParticipantIdSchema = IdentifierSchema;

const ActivityStateSchema = Type.Union([
  Type.Literal("starting"),
  Type.Literal("briefing"),
  Type.Literal("working"),
  Type.Literal("waiting"),
  Type.Literal("testing"),
  Type.Literal("committing"),
  Type.Literal("paused"),
  Type.Literal("town_hall"),
  Type.Literal("stopped"),
  Type.Literal("failed"),
]);

export const ActivityReportedPayloadSchema = Type.Object(
  {
    schemaVersion: Type.Literal(OBSERVABILITY_PAYLOAD_VERSION),
    participantId: ParticipantIdSchema,
    state: ActivityStateSchema,
    summary: Type.String({ minLength: 1, maxLength: 280 }),
    provenance: Type.Union([
      Type.Literal("agent_submitted"),
      Type.Literal("runtime_observed"),
    ]),
  },
  { additionalProperties: false },
);

const AgentRationaleSchema = Type.Object(
  {
    schemaVersion: Type.Literal(OBSERVABILITY_PAYLOAD_VERSION),
    participantId: ParticipantIdSchema,
    body: Type.String({ minLength: 1, maxLength: 2_000 }),
    provenance: Type.Literal("agent_submitted"),
    provider: Type.Null(),
    model: Type.Null(),
  },
  { additionalProperties: false },
);
const ProviderRationaleSchema = Type.Object(
  {
    schemaVersion: Type.Literal(OBSERVABILITY_PAYLOAD_VERSION),
    participantId: ParticipantIdSchema,
    body: Type.String({ minLength: 1, maxLength: 2_000 }),
    provenance: Type.Literal("provider_reasoning_summary"),
    provider: Type.String({ minLength: 1, maxLength: 128 }),
    model: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
export const RationaleSubmittedPayloadSchema = Type.Union([
  AgentRationaleSchema,
  ProviderRationaleSchema,
]);

export const ToolObservedPayloadSchema = Type.Object(
  {
    schemaVersion: Type.Literal(OBSERVABILITY_PAYLOAD_VERSION),
    participantId: ParticipantIdSchema,
    toolCallId: IdentifierSchema,
    toolName: IdentifierSchema,
    status: Type.Union([
      Type.Literal("started"),
      Type.Literal("completed"),
      Type.Literal("failed"),
    ]),
    summary: Type.Union([
      Type.String({ minLength: 1, maxLength: 500 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const FrameBase = {
  schemaVersion: Type.Literal(OBSERVABILITY_PAYLOAD_VERSION),
  participantId: ParticipantIdSchema,
  frameId: IdentifierSchema,
  captureReason: Type.Union([
    Type.Literal("action"),
    Type.Literal("heartbeat"),
    Type.Literal("phase_boundary"),
    Type.Literal("operator_request"),
  ]),
  frameSequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
} as const;
const VisibleFrameSchema = Type.Object(
  {
    ...FrameBase,
    mediaType: Type.Literal("image/png"),
    width: Type.Integer({ minimum: 1, maximum: 7_680 }),
    height: Type.Integer({ minimum: 1, maximum: 4_320 }),
    byteCount: Type.Integer({ minimum: 1, maximum: 16_777_216 }),
    digest: DigestSchema,
    redactionStatus: Type.Union([
      Type.Literal("clear"),
      Type.Literal("redacted"),
    ]),
    withheldReason: Type.Null(),
  },
  { additionalProperties: false },
);
const WithheldFrameSchema = Type.Object(
  {
    ...FrameBase,
    mediaType: Type.Null(),
    width: Type.Null(),
    height: Type.Null(),
    byteCount: Type.Literal(0),
    digest: Type.Null(),
    redactionStatus: Type.Literal("withheld"),
    withheldReason: Type.Union([
      Type.Literal("suspected_secret"),
      Type.Literal("capture_failed"),
      Type.Literal("policy"),
    ]),
  },
  { additionalProperties: false },
);
export const ComputerFrameCapturedPayloadSchema = Type.Union([
  VisibleFrameSchema,
  WithheldFrameSchema,
]);

export const MemoryUpdatedPayloadSchema = Type.Object(
  {
    schemaVersion: Type.Literal(OBSERVABILITY_PAYLOAD_VERSION),
    participantId: ParticipantIdSchema,
    memoryId: IdentifierSchema,
    revision: Type.Integer({ minimum: 1, maximum: 10_000 }),
    reason: Type.Union([
      Type.Literal("agent_consolidation"),
      Type.Literal("round_transition"),
      Type.Literal("resume"),
    ]),
    summary: Type.String({ minLength: 1, maxLength: 500 }),
    byteCount: Type.Integer({ minimum: 1, maximum: 262_144 }),
    digest: DigestSchema,
    previousDigest: NullableDigestSchema,
  },
  { additionalProperties: false },
);

export const MessagePublishedPayloadSchema = Type.Object(
  {
    messageId: IdentifierSchema,
    participantId: ParticipantIdSchema,
    channel: Type.Union([Type.Literal("general"), Type.Literal("town_hall")]),
    body: Type.String({ minLength: 1, maxLength: 4_000 }),
  },
  { additionalProperties: false },
);

const MatchPhaseSchema = Type.Union([
  Type.Literal("briefing"),
  Type.Literal("work"),
  Type.Literal("evidence"),
  Type.Literal("belief"),
  Type.Literal("town_hall"),
  Type.Literal("governance"),
  Type.Literal("integration"),
  Type.Literal("completion"),
]);
const MatchPositionSchema = Type.Object(
  {
    round: Type.Integer({ minimum: 1, maximum: 3 }),
    phase: MatchPhaseSchema,
  },
  { additionalProperties: false },
);
export const PhaseAdvancedPayloadSchema = Type.Object(
  { from: MatchPositionSchema, to: MatchPositionSchema },
  { additionalProperties: false },
);

export const TownHallStartedPayloadSchema = Type.Object(
  {
    round: Type.Integer({ minimum: 1, maximum: 3 }),
    speakingOrder: Type.Array(ParticipantIdSchema, {
      minItems: 4,
      maxItems: 4,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
const CitationSchema = Type.Object(
  {
    eventId: IdentifierSchema,
    claimedKind: EventKindSchema,
    status: Type.Union([
      Type.Literal("valid"),
      Type.Literal("mismatched"),
      Type.Literal("missing"),
    ]),
  },
  { additionalProperties: false },
);
export const TownHallTurnRecordedPayloadSchema = Type.Object(
  {
    turn: Type.Object(
      {
        turnId: IdentifierSchema,
        participantId: ParticipantIdSchema,
        pass: Type.Union([
          Type.Literal("evidence_accusation"),
          Type.Literal("defence_rebuttal"),
        ]),
        message: Type.Union([
          Type.String({ minLength: 1, maxLength: 4_000 }),
          Type.Null(),
        ]),
        citations: Type.Array(CitationSchema, { maxItems: 64 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ObservabilityPayloadSchemas = {
  "match.phase_advanced": PhaseAdvancedPayloadSchema,
  "runtime.activity_reported": ActivityReportedPayloadSchema,
  "runtime.rationale_submitted": RationaleSubmittedPayloadSchema,
  "runtime.tool_observed": ToolObservedPayloadSchema,
  "runtime.computer_frame_captured": ComputerFrameCapturedPayloadSchema,
  "memory.updated": MemoryUpdatedPayloadSchema,
  "message.published": MessagePublishedPayloadSchema,
  "town_hall.started": TownHallStartedPayloadSchema,
  "town_hall.turn_recorded": TownHallTurnRecordedPayloadSchema,
} as const;

export type ObservabilityEventKind = keyof typeof ObservabilityPayloadSchemas;
type PayloadFor<K extends ObservabilityEventKind> = Type.Static<
  (typeof ObservabilityPayloadSchemas)[K]
>;
export type ObservabilityEvent = {
  [K in ObservabilityEventKind]: Omit<EventEnvelope, "kind" | "payload"> & {
    readonly kind: K;
    readonly payload: PayloadFor<K>;
  };
}[ObservabilityEventKind];

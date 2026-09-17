import Type from "typebox";

export const COMMAND_PROTOCOL_VERSION = "1.0" as const;
export const EVENT_SCHEMA_VERSION = "1.0" as const;
export const EVENT_DELIVERY_VERSION = "1.0" as const;

const JSON_SCHEMA_DRAFT_2020_12 =
  "https://json-schema.org/draft/2020-12/schema" as const;

const IdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
});

const MessageKindSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
});

export const JsonValueSchema = Type.Cyclic(
  {
    JsonValue: Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Type.Ref("JsonValue")),
      Type.Record(Type.String(), Type.Ref("JsonValue")),
    ]),
  },
  "JsonValue",
);
export type JsonValue = Type.Static<typeof JsonValueSchema>;

export const ActorSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("participant"),
      Type.Literal("operator"),
      Type.Literal("controller"),
      Type.Literal("runtime"),
    ]),
    id: IdentifierSchema,
  },
  { additionalProperties: false },
);

export const CapabilityContextSchema = Type.Object(
  { tokenId: Type.Union([IdentifierSchema, Type.Null()]) },
  { additionalProperties: false },
);

export const CommandEnvelopeSchema = Type.Object(
  {
    protocolVersion: Type.Literal(COMMAND_PROTOCOL_VERSION),
    commandId: IdentifierSchema,
    runId: Type.Union([IdentifierSchema, Type.Null()]),
    actor: ActorSchema,
    capability: CapabilityContextSchema,
    kind: MessageKindSchema,
    payload: JsonValueSchema,
  },
  {
    $id: "urn:code-nest:protocol:v1:command-envelope",
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    additionalProperties: false,
  },
);
export type CommandEnvelope = Type.Static<typeof CommandEnvelopeSchema>;

function untargetedVisibility<const T extends string>(visibilityClass: T) {
  return Type.Object(
    { class: Type.Literal(visibilityClass) },
    { additionalProperties: false },
  );
}

function targetedVisibility<const T extends string>(visibilityClass: T) {
  return Type.Object(
    {
      class: Type.Literal(visibilityClass),
      recipientIds: Type.Array(IdentifierSchema, {
        minItems: 1,
        maxItems: 64,
        uniqueItems: true,
      }),
    },
    { additionalProperties: false },
  );
}

export const VisibilitySchema = Type.Union([
  untargetedVisibility("public"),
  untargetedVisibility("operator_private"),
  untargetedVisibility("post_reveal"),
  targetedVisibility("participant_private"),
  targetedVisibility("covert"),
]);

export const EventEnvelopeSchema = Type.Object(
  {
    schemaVersion: Type.Literal(EVENT_SCHEMA_VERSION),
    eventId: IdentifierSchema,
    runId: IdentifierSchema,
    sequence: Type.Integer({ minimum: 1 }),
    recordedAt: Type.String({ format: "date-time" }),
    actor: ActorSchema,
    context: Type.Object(
      {
        round: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        phase: Type.Union([MessageKindSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    kind: MessageKindSchema,
    payload: JsonValueSchema,
    visibility: VisibilitySchema,
    causationId: Type.Union([IdentifierSchema, Type.Null()]),
    correlationId: IdentifierSchema,
    parentEventIds: Type.Array(IdentifierSchema, {
      maxItems: 256,
      uniqueItems: true,
    }),
    artifactDigests: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 256,
      uniqueItems: true,
    }),
    resourceCost: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
  },
  {
    $id: "urn:code-nest:protocol:v1:event-envelope",
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    additionalProperties: false,
  },
);
export type EventEnvelope = Type.Static<typeof EventEnvelopeSchema>;

export const DeliveredEventSchema = Type.Omit(EventEnvelopeSchema, ["sequence"], {
  $id: "urn:code-nest:protocol:v1:delivered-event",
  $schema: JSON_SCHEMA_DRAFT_2020_12,
  additionalProperties: false,
});
export type DeliveredEvent = Type.Static<typeof DeliveredEventSchema>;

export const EventDeliverySchema = Type.Object(
  {
    deliveryVersion: Type.Literal(EVENT_DELIVERY_VERSION),
    deliverySequence: Type.Integer({ minimum: 1 }),
    event: DeliveredEventSchema,
  },
  {
    $id: "urn:code-nest:protocol:v1:event-delivery",
    $schema: JSON_SCHEMA_DRAFT_2020_12,
    additionalProperties: false,
  },
);
export type EventDelivery = Type.Static<typeof EventDeliverySchema>;

import { describe, expect, it } from "vitest";
import Schema from "typebox/schema";

import {
  COMMAND_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  EVENT_DELIVERY_VERSION,
  EVENT_SCHEMA_VERSION,
  EventDeliverySchema,
  EventEnvelopeSchema,
  parseCommandEnvelope,
  parseEventDelivery,
  parseEventEnvelope,
} from "./envelopes";

const validCommand = {
  protocolVersion: COMMAND_PROTOCOL_VERSION,
  commandId: "cmd-001",
  runId: "run-001",
  actor: {
    kind: "participant",
    id: "player-a",
  },
  capability: {
    tokenId: "cap-001",
  },
  kind: "message.publish",
  payload: {
    channel: "public",
    body: "Ready to integrate.",
  },
} as const;

const validEvent = {
  schemaVersion: EVENT_SCHEMA_VERSION,
  eventId: "evt-001",
  runId: "run-001",
  sequence: 1,
  recordedAt: "2026-09-17T12:00:00.000Z",
  actor: {
    kind: "controller",
    id: "controller",
  },
  context: {
    round: 0,
    phase: "briefing",
  },
  kind: "command.accepted",
  payload: {
    commandId: "cmd-001",
  },
  visibility: {
    class: "participant_private",
    recipientIds: ["player-a"],
  },
  causationId: "cmd-001",
  correlationId: "corr-001",
  parentEventIds: [],
  artifactDigests: [],
  resourceCost: {},
} as const;

const { sequence: _sourceSequence, ...deliveredEvent } = validEvent;
void _sourceSequence;
const validDelivery = {
  deliveryVersion: EVENT_DELIVERY_VERSION,
  deliverySequence: 1,
  event: deliveredEvent,
} as const;

describe("versioned command envelopes", () => {
  it("accepts a valid command without changing it", () => {
    expect(parseCommandEnvelope(validCommand)).toEqual({
      ok: true,
      value: validCommand,
    });
  });

  it("rejects unsupported protocol versions with a stable error", () => {
    expect(
      parseCommandEnvelope({
        ...validCommand,
        protocolVersion: "2.0",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "UNSUPPORTED_PROTOCOL_VERSION",
        envelope: "command",
        message:
          'Unsupported command protocol version "2.0". Supported versions: 1.0.',
        receivedVersion: "2.0",
        supportedVersions: ["1.0"],
        issues: [
          {
            code: "unsupported_version",
            message: "Expected one of: 1.0.",
            path: "/protocolVersion",
          },
        ],
      },
    });
  });

  it("reports missing and unknown fields with stable JSON-pointer paths", () => {
    const withoutActor: Record<string, unknown> = { ...validCommand };
    delete withoutActor.actor;
    const result = parseCommandEnvelope({
      ...withoutActor,
      unexpected: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("INVALID_COMMAND_ENVELOPE");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        {
          code: "required",
          message: "Required field is missing.",
          path: "/actor",
        },
        {
          code: "unexpected_property",
          message: "Unexpected property.",
          path: "/unexpected",
        },
      ]),
    );
  });

  it("rejects bearer credentials from capability context", () => {
    const result = parseCommandEnvelope({
      ...validCommand,
      capability: {
        tokenId: "cap-001",
        bearerToken: "must-not-enter-the-ledger",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.issues).toContainEqual({
      code: "unexpected_property",
      message: "Unexpected property.",
      path: "/capability/bearerToken",
    });
  });
});

describe("versioned event envelopes", () => {
  it("accepts an event with targeted visibility", () => {
    expect(parseEventEnvelope(validEvent)).toEqual({
      ok: true,
      value: validEvent,
    });
  });

  it("rejects unsupported event schema versions with a stable error", () => {
    const result = parseEventEnvelope({
      ...validEvent,
      schemaVersion: "9.0",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "UNSUPPORTED_SCHEMA_VERSION",
        envelope: "event",
        message:
          'Unsupported event schema version "9.0". Supported versions: 1.0.',
        receivedVersion: "9.0",
        supportedVersions: ["1.0"],
        issues: [
          {
            code: "unsupported_version",
            message: "Expected one of: 1.0.",
            path: "/schemaVersion",
          },
        ],
      },
    });
  });

  it("rejects invalid sequence, timestamp, and visibility", () => {
    const result = parseEventEnvelope({
      ...validEvent,
      sequence: 0,
      recordedAt: "sometime later",
      visibility: {
        class: "participant_private",
        recipientIds: [],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("INVALID_EVENT_ENVELOPE");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "minimum", path: "/sequence" }),
        expect.objectContaining({ code: "format", path: "/recordedAt" }),
        expect.objectContaining({
          code: "minItems",
          path: "/visibility/recipientIds",
        }),
      ]),
    );
  });

  it("rejects values that cannot cross a JSON boundary", () => {
    const result = parseEventEnvelope({
      ...validEvent,
      payload: {
        observedAt: new Date("2026-09-17T12:00:00.000Z"),
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("INVALID_EVENT_ENVELOPE");
    expect(result.error.issues).toContainEqual({
      code: "non_json_value",
      message: "Value must be representable in JSON.",
      path: "/payload/observedAt",
    });
  });

  it("rejects cyclic payloads without recursing in the schema validator", () => {
    const payload: Record<string, unknown> = {};
    payload.self = payload;

    const result = parseEventEnvelope({ ...validEvent, payload });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.issues).toContainEqual({
      code: "cyclic_value",
      message: "Value must not contain cycles.",
      path: "/payload/self",
    });
  });
});

describe("audience-safe event deliveries", () => {
  it("accepts a delivery without a ledger sequence", () => {
    expect(parseEventDelivery(validDelivery)).toEqual({
      ok: true,
      value: validDelivery,
    });
  });

  it("rejects a leaked ledger sequence", () => {
    const result = parseEventDelivery({
      ...validDelivery,
      event: { ...validDelivery.event, sequence: 7 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toContainEqual({
      code: "unexpected_property",
      message: "Unexpected property.",
      path: "/event/sequence",
    });
  });

  it("rejects unsupported delivery versions with a stable error", () => {
    expect(
      parseEventDelivery({ ...validDelivery, deliveryVersion: "2.0" }),
    ).toEqual({
      ok: false,
      error: {
        code: "UNSUPPORTED_EVENT_DELIVERY_VERSION",
        message:
          'Unsupported event delivery version "2.0". Supported versions: 1.0.',
        receivedVersion: "2.0",
        supportedVersions: ["1.0"],
        issues: [
          {
            code: "unsupported_version",
            message: "Expected one of: 1.0.",
            path: "/deliveryVersion",
          },
        ],
      },
    });
  });

  it("checks delivered payloads at transport-relative paths", () => {
    const result = parseEventDelivery({
      ...validDelivery,
      event: { ...validDelivery.event, payload: { observedAt: new Date() } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toContainEqual({
      code: "non_json_value",
      message: "Value must be representable in JSON.",
      path: "/event/payload/observedAt",
    });
  });
});

describe("portable envelope schemas", () => {
  it("exports strict JSON Schema 2020-12 documents", () => {
    const commandSchema = JSON.parse(JSON.stringify(CommandEnvelopeSchema));
    const deliverySchema = JSON.parse(JSON.stringify(EventDeliverySchema));
    const eventSchema = JSON.parse(JSON.stringify(EventEnvelopeSchema));

    expect(commandSchema).toMatchObject({
      $id: "urn:code-nest:protocol:v1:command-envelope",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      type: "object",
    });
    expect(eventSchema).toMatchObject({
      $id: "urn:code-nest:protocol:v1:event-envelope",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      type: "object",
    });
    expect(deliverySchema).toMatchObject({
      $id: "urn:code-nest:protocol:v1:event-delivery",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      type: "object",
    });
  });

  it("validates with schemas reconstructed from serialized JSON", () => {
    const commandSchema = JSON.parse(JSON.stringify(CommandEnvelopeSchema));
    const deliverySchema = JSON.parse(JSON.stringify(EventDeliverySchema));
    const eventSchema = JSON.parse(JSON.stringify(EventEnvelopeSchema));

    expect(Schema.Compile(commandSchema).Check(validCommand)).toBe(true);
    expect(Schema.Compile(deliverySchema).Check(validDelivery)).toBe(true);
    expect(Schema.Compile(eventSchema).Check(validEvent)).toBe(true);
  });
});

import Schema from "typebox/schema";

import {
  COMMAND_PROTOCOL_VERSION,
  CommandEnvelopeSchema,
  EVENT_DELIVERY_VERSION,
  EventDeliverySchema,
  EventEnvelopeSchema,
  type CommandEnvelope,
  type EventDelivery,
  type EventEnvelope,
} from "./envelope-schemas.js";
import {
  deliveryPayloadJsonIssue,
  isRecord,
  normalizeIssues,
  payloadJsonIssue,
  sortUniqueIssues,
  targetedVisibilityIssues,
  type RawValidationIssue,
  type ValidationIssue,
} from "./envelope-validation.js";

export interface InvalidEnvelopeError {
  code: "INVALID_COMMAND_ENVELOPE" | "INVALID_EVENT_ENVELOPE";
  envelope: "command" | "event";
  message: string;
  issues: ValidationIssue[];
}

export interface UnsupportedVersionError {
  code: "UNSUPPORTED_PROTOCOL_VERSION" | "UNSUPPORTED_SCHEMA_VERSION";
  envelope: "command" | "event";
  message: string;
  receivedVersion: string;
  supportedVersions: readonly ["1.0"];
  issues: ValidationIssue[];
}

export type EnvelopeError = InvalidEnvelopeError | UnsupportedVersionError;
export type ParseResult<T, Error = EnvelopeError> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

export interface InvalidEventDeliveryError {
  code: "INVALID_EVENT_DELIVERY";
  message: string;
  issues: ValidationIssue[];
}

export interface UnsupportedEventDeliveryVersionError {
  code: "UNSUPPORTED_EVENT_DELIVERY_VERSION";
  message: string;
  receivedVersion: string;
  supportedVersions: readonly ["1.0"];
  issues: ValidationIssue[];
}

export type EventDeliveryError =
  | InvalidEventDeliveryError
  | UnsupportedEventDeliveryVersionError;

const commandValidator = Schema.Compile(CommandEnvelopeSchema);
const eventValidator = Schema.Compile(EventEnvelopeSchema);
const eventDeliveryValidator = Schema.Compile(EventDeliverySchema);

function validatorIssues(
  errors: ReturnType<typeof commandValidator.Errors>[1],
): RawValidationIssue[] {
  return errors;
}

function unsupportedVersion(
  input: unknown,
  envelope: "command" | "event",
  versionField: "protocolVersion" | "schemaVersion",
): UnsupportedVersionError | undefined {
  if (!isRecord(input)) return undefined;
  const receivedVersion = input[versionField];
  if (typeof receivedVersion !== "string" || receivedVersion === "1.0") {
    return undefined;
  }
  const versionName = envelope === "command" ? "protocol" : "schema";
  return {
    code:
      envelope === "command"
        ? "UNSUPPORTED_PROTOCOL_VERSION"
        : "UNSUPPORTED_SCHEMA_VERSION",
    envelope,
    message: `Unsupported ${envelope} ${versionName} version "${receivedVersion}". Supported versions: 1.0.`,
    receivedVersion,
    supportedVersions: [COMMAND_PROTOCOL_VERSION],
    issues: [
      {
        code: "unsupported_version",
        message: "Expected one of: 1.0.",
        path: `/${versionField}`,
      },
    ],
  };
}

export function parseCommandEnvelope(
  input: unknown,
): ParseResult<CommandEnvelope> {
  const versionError = unsupportedVersion(input, "command", "protocolVersion");
  if (versionError !== undefined) return { ok: false, error: versionError };
  const jsonIssue = payloadJsonIssue(input);
  if (jsonIssue !== undefined) {
    return {
      ok: false,
      error: {
        code: "INVALID_COMMAND_ENVELOPE",
        envelope: "command",
        message: "Command envelope failed validation.",
        issues: [jsonIssue],
      },
    };
  }
  if (commandValidator.Check(input)) return { ok: true, value: input };
  const [, errors] = commandValidator.Errors(input);
  return {
    ok: false,
    error: {
      code: "INVALID_COMMAND_ENVELOPE",
      envelope: "command",
      message: "Command envelope failed validation.",
      issues: normalizeIssues(validatorIssues(errors)),
    },
  };
}

export function parseEventEnvelope(input: unknown): ParseResult<EventEnvelope> {
  const versionError = unsupportedVersion(input, "event", "schemaVersion");
  if (versionError !== undefined) return { ok: false, error: versionError };
  const jsonIssue = payloadJsonIssue(input);
  if (jsonIssue !== undefined) {
    return {
      ok: false,
      error: {
        code: "INVALID_EVENT_ENVELOPE",
        envelope: "event",
        message: "Event envelope failed validation.",
        issues: [jsonIssue],
      },
    };
  }
  if (eventValidator.Check(input)) return { ok: true, value: input };
  const [, errors] = eventValidator.Errors(input);
  return {
    ok: false,
    error: {
      code: "INVALID_EVENT_ENVELOPE",
      envelope: "event",
      message: "Event envelope failed validation.",
      issues: sortUniqueIssues([
        ...normalizeIssues(validatorIssues(errors)),
        ...targetedVisibilityIssues(input),
      ]),
    },
  };
}

export function parseEventDelivery(
  input: unknown,
): ParseResult<EventDelivery, EventDeliveryError> {
  if (isRecord(input)) {
    const receivedVersion = input.deliveryVersion;
    if (
      typeof receivedVersion === "string" &&
      receivedVersion !== EVENT_DELIVERY_VERSION
    ) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_EVENT_DELIVERY_VERSION",
          message: `Unsupported event delivery version "${receivedVersion}". Supported versions: 1.0.`,
          receivedVersion,
          supportedVersions: [EVENT_DELIVERY_VERSION],
          issues: [
            {
              code: "unsupported_version",
              message: "Expected one of: 1.0.",
              path: "/deliveryVersion",
            },
          ],
        },
      };
    }
  }
  const jsonIssue = deliveryPayloadJsonIssue(input);
  if (jsonIssue !== undefined) {
    return {
      ok: false,
      error: {
        code: "INVALID_EVENT_DELIVERY",
        message: "Event delivery failed validation.",
        issues: [jsonIssue],
      },
    };
  }
  if (eventDeliveryValidator.Check(input)) return { ok: true, value: input };
  const [, errors] = eventDeliveryValidator.Errors(input);
  return {
    ok: false,
    error: {
      code: "INVALID_EVENT_DELIVERY",
      message: "Event delivery failed validation.",
      issues: normalizeIssues(validatorIssues(errors)),
    },
  };
}

import Type from "typebox";
import Schema from "typebox/schema";

export const COMMAND_PROTOCOL_VERSION = "1.0" as const;
export const EVENT_SCHEMA_VERSION = "1.0" as const;

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
  {
    tokenId: Type.Union([IdentifierSchema, Type.Null()]),
  },
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

export interface ValidationIssue {
  code: string;
  message: string;
  path: string;
}

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

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EnvelopeError };

const commandValidator = Schema.Compile(CommandEnvelopeSchema);
const eventValidator = Schema.Compile(EventEnvelopeSchema);

type RawValidationIssue = ReturnType<
  typeof commandValidator.Errors
>[1][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeJsonPointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path: string, child: string): string {
  return `${path}/${escapeJsonPointer(child)}`;
}

function nonJsonIssue(path: string): ValidationIssue {
  return {
    code: "non_json_value",
    message: "Value must be representable in JSON.",
    path,
  };
}

function findNonJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): ValidationIssue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : nonJsonIssue(path);
  }

  if (typeof value !== "object") return nonJsonIssue(path);
  if (ancestors.has(value)) {
    return {
      code: "cyclic_value",
      message: "Value must not contain cycles.",
      path,
    };
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const extraKey = Object.keys(value).find(
        (key) => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length,
      );
      if (extraKey !== undefined) return nonJsonIssue(childPath(path, extraKey));

      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          return nonJsonIssue(childPath(path, String(index)));
        }

        const issue = findNonJsonValue(
          descriptor.value,
          childPath(path, String(index)),
          ancestors,
        );
        if (issue !== undefined) return issue;
      }
      return undefined;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return nonJsonIssue(path);
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return nonJsonIssue(path);

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return nonJsonIssue(childPath(path, key));
      }

      const issue = findNonJsonValue(
        descriptor.value,
        childPath(path, key),
        ancestors,
      );
      if (issue !== undefined) return issue;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

function payloadJsonIssue(input: unknown): ValidationIssue | undefined {
  if (!isRecord(input) || !("payload" in input)) return undefined;
  return findNonJsonValue(input.payload, "/payload", new Set<object>());
}

function stringArrayParam(
  issue: RawValidationIssue,
  name: string,
): string[] | undefined {
  const value = (issue.params as Record<string, unknown>)[name];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function scalarParam(
  issue: RawValidationIssue,
  name: string,
): string | number | bigint | undefined {
  const value = (issue.params as Record<string, unknown>)[name];
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
    ? value
    : undefined;
}

function stableMessage(issue: RawValidationIssue): string {
  const limit = scalarParam(issue, "limit");
  const format = scalarParam(issue, "format");
  const type = scalarParam(issue, "type");

  switch (issue.keyword) {
    case "minimum":
      return `Must be greater than or equal to ${String(limit)}.`;
    case "maximum":
      return `Must be less than or equal to ${String(limit)}.`;
    case "minItems":
      return `Must contain at least ${String(limit)} item(s).`;
    case "maxItems":
      return `Must contain at most ${String(limit)} item(s).`;
    case "minLength":
      return `Must contain at least ${String(limit)} character(s).`;
    case "maxLength":
      return `Must contain at most ${String(limit)} character(s).`;
    case "format":
      return `Must match format "${String(format)}".`;
    case "type":
      return `Must be ${String(type)}.`;
    case "uniqueItems":
      return "Must not contain duplicate items.";
    case "anyOf":
      return "Must match one allowed shape.";
    case "const":
      return "Must equal the declared constant value.";
    case "pattern":
      return "Must match the required pattern.";
    default:
      return `Failed validation rule "${issue.keyword}".`;
  }
}

function sortUniqueIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const unique = new Map<string, ValidationIssue>();
  for (const issue of issues) {
    unique.set(`${issue.path}\u0000${issue.code}\u0000${issue.message}`, issue);
  }

  return [...unique.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

function normalizeIssues(errors: RawValidationIssue[]): ValidationIssue[] {
  const normalized = errors.flatMap<ValidationIssue>((issue) => {
    if (issue.keyword === "required") {
      const properties = stringArrayParam(issue, "requiredProperties") ?? [];
      return properties.map((property) => ({
        code: "required",
        message: "Required field is missing.",
        path: childPath(issue.instancePath, property),
      }));
    }

    if (issue.keyword === "additionalProperties") {
      const properties = stringArrayParam(issue, "additionalProperties") ?? [];
      return properties.map((property) => ({
        code: "unexpected_property",
        message: "Unexpected property.",
        path: childPath(issue.instancePath, property),
      }));
    }

    if (
      issue.keyword === "boolean" &&
      issue.schemaPath.endsWith("/additionalProperties")
    ) {
      return [];
    }

    return [
      {
        code: issue.keyword,
        message: stableMessage(issue),
        path: issue.instancePath,
      },
    ];
  });

  return sortUniqueIssues(normalized);
}

function targetedVisibilityIssues(input: unknown): ValidationIssue[] {
  if (!isRecord(input) || !isRecord(input.visibility)) return [];

  const visibility = input.visibility;
  if (
    visibility.class !== "participant_private" &&
    visibility.class !== "covert"
  ) {
    return [];
  }

  const recipientIds = visibility.recipientIds;
  if (!Array.isArray(recipientIds)) return [];

  const issues: ValidationIssue[] = [];
  if (recipientIds.length < 1) {
    issues.push({
      code: "minItems",
      message: "Must contain at least 1 item(s).",
      path: "/visibility/recipientIds",
    });
  }
  if (recipientIds.length > 64) {
    issues.push({
      code: "maxItems",
      message: "Must contain at most 64 item(s).",
      path: "/visibility/recipientIds",
    });
  }
  if (new Set(recipientIds).size !== recipientIds.length) {
    issues.push({
      code: "uniqueItems",
      message: "Must not contain duplicate items.",
      path: "/visibility/recipientIds",
    });
  }

  return issues;
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
    supportedVersions: ["1.0"],
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
  const versionError = unsupportedVersion(
    input,
    "command",
    "protocolVersion",
  );
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
      issues: normalizeIssues(errors),
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
        ...normalizeIssues(errors),
        ...targetedVisibilityIssues(input),
      ]),
    },
  };
}

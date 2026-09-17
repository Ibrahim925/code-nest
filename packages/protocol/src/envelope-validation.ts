export interface ValidationIssue {
  code: string;
  message: string;
  path: string;
}

export interface RawValidationIssue {
  keyword: string;
  params: unknown;
  instancePath: string;
  schemaPath: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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
    return { code: "cyclic_value", message: "Value must not contain cycles.", path };
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

export function payloadJsonIssue(
  input: unknown,
): ValidationIssue | undefined {
  if (!isRecord(input) || !("payload" in input)) return undefined;
  return findNonJsonValue(input.payload, "/payload", new Set<object>());
}

export function deliveryPayloadJsonIssue(
  input: unknown,
): ValidationIssue | undefined {
  if (!isRecord(input) || !isRecord(input.event)) return undefined;
  const issue = payloadJsonIssue(input.event);
  return issue === undefined ? undefined : { ...issue, path: `/event${issue.path}` };
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

export function sortUniqueIssues(
  issues: ValidationIssue[],
): ValidationIssue[] {
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

export function normalizeIssues(
  errors: RawValidationIssue[],
): ValidationIssue[] {
  const normalized = errors.flatMap<ValidationIssue>((issue) => {
    if (issue.keyword === "required") {
      return (stringArrayParam(issue, "requiredProperties") ?? []).map(
        (property) => ({
          code: "required",
          message: "Required field is missing.",
          path: childPath(issue.instancePath, property),
        }),
      );
    }
    if (issue.keyword === "additionalProperties") {
      return (stringArrayParam(issue, "additionalProperties") ?? []).map(
        (property) => ({
          code: "unexpected_property",
          message: "Unexpected property.",
          path: childPath(issue.instancePath, property),
        }),
      );
    }
    if (
      issue.keyword === "boolean" &&
      issue.schemaPath.endsWith("/additionalProperties")
    ) {
      return [];
    }
    return [{ code: issue.keyword, message: stableMessage(issue), path: issue.instancePath }];
  });
  return sortUniqueIssues(normalized);
}

export function targetedVisibilityIssues(input: unknown): ValidationIssue[] {
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

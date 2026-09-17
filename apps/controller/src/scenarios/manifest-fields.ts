import { isAbsolute } from "node:path";

import {
  ScenarioManifestError,
  type ScenarioDigest,
  type ScenarioFileReference,
} from "./manifest-contract.js";

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const PORTABLE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function invalid(field: string, message: string): never {
  throw new ScenarioManifestError("INVALID_SCENARIO_MANIFEST", message, field);
}

export function exactObject(
  value: unknown,
  field: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) {
    return invalid(field, `Scenario manifest field ${field} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return invalid(
      field,
      `Scenario manifest field ${field} must contain exactly: ${expected.join(", ")}.`,
    );
  }
  return value;
}

export function requiredString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength
  ) {
    return invalid(
      field,
      `Scenario manifest field ${field} must be a non-empty string of at most ${maximumLength} characters.`,
    );
  }
  return value;
}

export function identifier(value: unknown, field: string): string {
  const parsed = requiredString(value, field, 128);
  if (!IDENTIFIER_PATTERN.test(parsed)) {
    return invalid(
      field,
      `Scenario manifest field ${field} must be a lowercase portable identifier.`,
    );
  }
  return parsed;
}

export function portablePath(value: unknown, field: string): string {
  const parsed = requiredString(value, field, 512);
  const segments = parsed.split("/");
  if (
    isAbsolute(parsed) ||
    parsed.includes("\\") ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !PORTABLE_PATH_SEGMENT_PATTERN.test(segment),
    )
  ) {
    throw new ScenarioManifestError(
      "UNSAFE_SCENARIO_PATH",
      `Scenario path at ${field} must be a portable relative path inside the scenario root.`,
      field,
    );
  }
  return parsed;
}

export function scenarioDigest(value: unknown, field: string): ScenarioDigest {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    return invalid(
      field,
      `Scenario manifest field ${field} must use lowercase sha256:<64 hex> form.`,
    );
  }
  return value as ScenarioDigest;
}

export function fileReference(
  value: unknown,
  field: string,
): ScenarioFileReference {
  const record = exactObject(value, field, ["digest", "path"]);
  return {
    path: portablePath(record.path, `${field}/path`),
    digest: scenarioDigest(record.digest, `${field}/digest`),
  };
}

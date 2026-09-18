import type { JsonValue } from "@code-nest/protocol";

const REPLACEMENT = "[REDACTED]";

export class SecretRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretRedactionError";
  }
}

function normalizePatterns(patterns: readonly string[]): readonly string[] {
  if (patterns.length > 64) throw new SecretRedactionError("At most 64 secret patterns may be configured.");
  const unique = new Set<string>();
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || pattern.length < 8 || pattern.length > 4_096 || pattern.includes("\0")) {
      throw new SecretRedactionError("Secret patterns must contain 8 to 4096 safe characters.");
    }
    unique.add(pattern);
  }
  return [...unique].sort((left, right) => right.length - left.length || left.localeCompare(right));
}

export class SecretRedactor {
  readonly #patterns: readonly string[];

  constructor(patterns: readonly string[]) {
    this.#patterns = normalizePatterns(patterns);
  }

  redact(value: JsonValue): JsonValue {
    if (typeof value === "string") return this.#redactText(value);
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    const output: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      const redactedKey = this.#redactText(key);
      if (redactedKey in output) {
        throw new SecretRedactionError("Secret redaction would create duplicate object fields.");
      }
      output[redactedKey] = this.redact(child);
    }
    return output;
  }

  #redactText(input: string): string {
    let output = input;
    for (const pattern of this.#patterns) output = output.split(pattern).join(REPLACEMENT);
    return output;
  }
}

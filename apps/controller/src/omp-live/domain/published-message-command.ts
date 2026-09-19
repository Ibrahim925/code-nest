const MAXIMUM_MESSAGE_LENGTH = 4_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parsePublishedMessages(commands: readonly unknown[]): string[] {
  return commands.flatMap((command) => {
    const value = record(command);
    if (
      value === null ||
      Object.keys(value).sort().join("\0") !== "body\0type" ||
      value.type !== "message.publish" ||
      typeof value.body !== "string"
    ) {
      return [];
    }
    const body = value.body.trim();
    return body.length > 0 && body.length <= MAXIMUM_MESSAGE_LENGTH
      ? [body]
      : [];
  });
}

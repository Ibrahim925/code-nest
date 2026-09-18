import type { SanitizedText } from "../domain/activity-feed.js";

function stripTerminalControls(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x1b) {
      const next = value.charCodeAt(index + 1);
      if (next === 0x5b) {
        index += 2;
        while (index < value.length) {
          const current = value.charCodeAt(index);
          if (current >= 0x40 && current <= 0x7e) break;
          index += 1;
        }
      } else if (next === 0x5d) {
        index += 2;
        while (index < value.length) {
          if (value.charCodeAt(index) === 0x07) break;
          if (
            value.charCodeAt(index) === 0x1b &&
            value.charCodeAt(index + 1) === 0x5c
          ) {
            index += 1;
            break;
          }
          index += 1;
        }
      } else {
        index += 1;
      }
      continue;
    }
    if (code === 0x0d) {
      if (value.charCodeAt(index + 1) !== 0x0a) result += "\n";
      continue;
    }
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) {
      continue;
    }
    result += value[index];
  }
  return result;
}

export function sanitizeUntrustedText(
  input: unknown,
  maximumCharacters = 2_000,
  keepTail = false,
): SanitizedText | null {
  if (
    typeof input !== "string" ||
    !Number.isSafeInteger(maximumCharacters) ||
    maximumCharacters < 1
  ) return null;
  const cleaned = stripTerminalControls(input).normalize("NFC");
  if (cleaned.trim().length === 0) return null;
  if (cleaned.length <= maximumCharacters) {
    return { text: cleaned, truncated: false, format: "plain_text" };
  }
  const text = keepTail
    ? cleaned.slice(-maximumCharacters)
    : cleaned.slice(0, maximumCharacters);
  return { text, truncated: true, format: "plain_text" };
}

export function sanitizeFilename(input: unknown): string | null {
  const sanitized = sanitizeUntrustedText(input, 240);
  if (sanitized === null || sanitized.truncated) return null;
  const filename = sanitized.text.replaceAll("\n", " ").replaceAll("\t", " ");
  const segments = filename.replaceAll("\\", "/").split("/");
  if (
    filename.startsWith("/") ||
    /^[A-Za-z]:/.test(filename) ||
    segments.some((segment) => segment === ".." || segment === "")
  ) return null;
  return filename;
}

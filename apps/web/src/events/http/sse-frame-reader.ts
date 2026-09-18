import { EventStreamTransportError } from "../application/ports/event-stream.js";
import type { SseEventFrame } from "../domain/live-events.js";

const MAXIMUM_FRAME_BYTES = 256 * 1_024;

interface PendingFrame {
  event: string;
  dataLines: string[];
}

function appendData(frame: PendingFrame, value: string): void {
  frame.dataLines.push(value);
  const bytes = new TextEncoder().encode(frame.dataLines.join("\n")).byteLength;
  if (bytes > MAXIMUM_FRAME_BYTES) {
    throw new EventStreamTransportError(
      "EVENT_FRAME_TOO_LARGE",
      "The controller sent an oversized live event frame.",
      false,
    );
  }
}

function fieldValue(line: string): readonly [string, string] {
  const separator = line.indexOf(":");
  if (separator === -1) return [line, ""];
  const value = line.slice(separator + 1);
  return [line.slice(0, separator), value.startsWith(" ") ? value.slice(1) : value];
}

export async function* readSseFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEventFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEventId = "";
  let pending: PendingFrame = { event: "", dataLines: [] };

  try {
    while (true) {
      const result = await reader.read();
      buffer += decoder.decode(result.value, { stream: !result.done });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const rawLine = buffer.slice(0, newline);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        buffer = buffer.slice(newline + 1);
        if (line === "") {
          if (pending.dataLines.length > 0) {
            yield {
              id: lastEventId,
              event: pending.event === "" ? "message" : pending.event,
              data: pending.dataLines.join("\n"),
            };
          }
          pending = { event: "", dataLines: [] };
        } else if (!line.startsWith(":")) {
          const [field, value] = fieldValue(line);
          if (field === "data") appendData(pending, value);
          if (field === "event") pending.event = value;
          if (field === "id" && !value.includes("\0")) lastEventId = value;
        }
        newline = buffer.indexOf("\n");
      }
      if (new TextEncoder().encode(buffer).byteLength > MAXIMUM_FRAME_BYTES) {
        throw new EventStreamTransportError(
          "EVENT_FRAME_TOO_LARGE",
          "The controller sent an oversized live event frame.",
          false,
        );
      }
      if (result.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

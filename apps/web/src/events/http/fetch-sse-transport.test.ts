import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventStreamRequest } from "../application/ports/event-stream.js";
import type { SseEventFrame } from "../domain/live-events.js";
import { FetchSseTransport } from "./fetch-sse-transport.js";
import { readSseFrames } from "./sse-frame-reader.js";

function byteStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticated fetch SSE transport", () => {
  it("calls the browser fetch API with its required global receiver", async () => {
    vi.stubGlobal("fetch", async function (this: unknown) {
      expect(this).toBe(globalThis);
      return new Response(byteStream([]), {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const transport = new FetchSseTransport({ baseUrl: "/api" });

    await transport.open({
      runId: "run-028",
      bearerToken: "observer-secret",
      signal: new AbortController().signal,
    });
  });

  it("parses heartbeats, split CRLF boundaries, and multiline data", async () => {
    const stream = byteStream([
      ": connected\r",
      "\n\r\nid: event-1\r\nevent: code-nest-event\r\n",
      "data: first\r\ndata: second\r\n\r\n",
    ]);
    const frames: SseEventFrame[] = [];
    for await (const value of readSseFrames(stream)) frames.push(value);
    expect(frames).toEqual([
      {
        id: "event-1",
        event: "code-nest-event",
        data: "first\nsecond",
      },
    ]);
  });

  it("keeps authority out of the URL and sends the visible cursor as a header", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(
        byteStream(["id: event-2\nevent: code-nest-event\ndata: delivery\n\n"]),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
      );
    };
    const transport = new FetchSseTransport({ baseUrl: "/api", fetcher });
    const stream = await transport.open({
      runId: "run with spaces",
      bearerToken: "observer-secret",
      lastEventId: "event-1",
      signal: new AbortController().signal,
    });
    const frames: SseEventFrame[] = [];
    for await (const value of stream) frames.push(value);

    expect(requests[0]?.url).toBe("/api/runs/run%20with%20spaces/events");
    expect(requests[0]?.url).not.toContain("observer-secret");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer observer-secret",
      "last-event-id": "event-1",
      "x-code-nest-observer-view": "1",
    });
    expect(frames).toEqual([
      { id: "event-2", event: "code-nest-event", data: "delivery" },
    ]);
  });

  it("classifies rejected requests as terminal and server failures as recoverable", async () => {
    const responseFor = (status: number): FetchSseTransport =>
      new FetchSseTransport({
        baseUrl: "/api",
        fetcher: async () => new Response(null, { status }),
      });
    const request: EventStreamRequest = {
      runId: "run-028",
      bearerToken: "observer-secret",
      signal: new AbortController().signal,
    };

    await expect(responseFor(401).open(request)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      recoverable: false,
    });
    await expect(responseFor(503).open(request)).rejects.toMatchObject({
      code: "EVENT_STREAM_UNAVAILABLE",
      recoverable: true,
    });
  });
});

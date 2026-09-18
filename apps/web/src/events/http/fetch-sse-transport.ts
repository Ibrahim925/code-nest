import {
  EventStreamTransportError,
  type EventStreamRequest,
  type EventStreamTransport,
} from "../application/ports/event-stream.js";
import type { SseEventFrame } from "../domain/live-events.js";
import { readSseFrames } from "./sse-frame-reader.js";

export interface FetchSseTransportOptions {
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
}

function responseFailure(response: Response): EventStreamTransportError {
  if (response.status === 401) {
    return new EventStreamTransportError(
      "UNAUTHORIZED",
      "Valid stream authorization is required.",
      false,
    );
  }
  if (response.status === 404) {
    return new EventStreamTransportError(
      "RUN_NOT_FOUND",
      "The requested run was not found.",
      false,
    );
  }
  if (response.status >= 400 && response.status < 500) {
    return new EventStreamTransportError(
      "STREAM_REQUEST_REJECTED",
      "The controller rejected the live event request.",
      false,
    );
  }
  return new EventStreamTransportError(
    "EVENT_STREAM_UNAVAILABLE",
    "The controller event stream is temporarily unavailable.",
    true,
  );
}

export class FetchSseTransport implements EventStreamTransport {
  readonly #fetch: typeof fetch;

  constructor(private readonly options: FetchSseTransportOptions) {
    this.#fetch = options.fetcher ?? globalThis.fetch;
  }

  async open(request: EventStreamRequest): Promise<AsyncIterable<SseEventFrame>> {
    if (request.bearerToken.trim().length === 0) {
      throw new EventStreamTransportError(
        "MISSING_STREAM_TOKEN",
        "Enter an observer or operator token before following a run.",
        false,
      );
    }
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.options.baseUrl}/runs/${encodeURIComponent(request.runId)}/events`,
        {
          method: "GET",
          headers: {
            accept: "text/event-stream",
            authorization: `Bearer ${request.bearerToken}`,
            "cache-control": "no-cache",
            "x-code-nest-observer-view": "1",
            ...(request.lastEventId === undefined
              ? {}
              : { "last-event-id": request.lastEventId }),
          },
          signal: request.signal,
        },
      );
    } catch (error: unknown) {
      if (request.signal.aborted) throw error;
      throw new EventStreamTransportError(
        "EVENT_STREAM_NETWORK_ERROR",
        "The controller event stream could not be reached.",
        true,
      );
    }
    if (!response.ok) throw responseFailure(response);
    if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
      throw new EventStreamTransportError(
        "INVALID_STREAM_RESPONSE",
        "The controller returned an invalid live event stream.",
        false,
      );
    }
    if (response.body === null) {
      throw new EventStreamTransportError(
        "EMPTY_STREAM_RESPONSE",
        "The controller returned no live event stream body.",
        true,
      );
    }
    return readSseFrames(response.body);
  }
}

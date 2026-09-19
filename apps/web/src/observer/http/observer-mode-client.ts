import type { ObserverModeState } from "../domain/modes.js";
import { browserFetch } from "../../http/browser-fetch.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class ObserverModeClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ObserverModeClientError";
  }
}

export interface ObserverModeClient {
  get(runId: string, signal?: AbortSignal): Promise<ObserverModeState>;
  unblind(runId: string): Promise<ObserverModeState>;
}

export interface HttpObserverModeClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetcher?: typeof fetch;
  readonly createCommandId?: () => string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseMode(value: unknown): ObserverModeState {
  const source = record(value);
  const mode = source?.mode;
  if (
    source?.schemaVersion !== "1.0" || typeof source.runId !== "string" ||
    !IDENTIFIER.test(source.runId) ||
    (mode !== "clean" && mode !== "unblinded" && mode !== "post_match_reveal") ||
    typeof source.benchmarkEligible !== "boolean" ||
    !(source.unblindedEventId === null || typeof source.unblindedEventId === "string") ||
    !(source.revealedEventId === null || typeof source.revealedEventId === "string")
  ) {
    throw new ObserverModeClientError(
      "INVALID_OBSERVER_MODE_RESPONSE",
      "The controller returned invalid observer mode state.",
    );
  }
  return source as unknown as ObserverModeState;
}

async function responseError(response: Response): Promise<ObserverModeClientError> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return new ObserverModeClientError(
      "OBSERVER_MODE_REQUEST_FAILED",
      `The controller returned HTTP ${response.status}.`,
    );
  }
  const error = record(record(value)?.error);
  return new ObserverModeClientError(
    typeof error?.code === "string" ? error.code : "OBSERVER_MODE_REQUEST_FAILED",
    typeof error?.message === "string" ? error.message : "Observer mode request failed.",
  );
}

export class HttpObserverModeClient implements ObserverModeClient {
  readonly #fetch: typeof fetch;
  readonly #createCommandId: () => string;

  constructor(private readonly options: HttpObserverModeClientOptions) {
    this.#fetch = browserFetch(options.fetcher);
    this.#createCommandId = options.createCommandId ?? (() => crypto.randomUUID());
  }

  get(runId: string, signal?: AbortSignal): Promise<ObserverModeState> {
    return this.#request(runId, {
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
    });
  }

  unblind(runId: string): Promise<ObserverModeState> {
    return this.#request(runId, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "idempotency-key": this.#createCommandId() },
    }, "/unblind");
  }

  async #request(
    runId: string,
    init: RequestInit,
    suffix = "",
  ): Promise<ObserverModeState> {
    if (this.options.token.trim().length === 0) {
      throw new ObserverModeClientError(
        "MISSING_OPERATOR_TOKEN",
        "Operator authorization is required to change observer mode.",
      );
    }
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.options.baseUrl}/runs/${encodeURIComponent(runId)}/observer-mode${suffix}`,
        {
          ...init,
          headers: {
            authorization: `Bearer ${this.options.token}`,
            "content-type": "application/json",
            ...init.headers,
          },
        },
      );
    } catch (error: unknown) {
      if (init.signal?.aborted) throw error;
      throw new ObserverModeClientError(
        "OBSERVER_MODE_UNREACHABLE",
        "Observer mode state could not be reached.",
      );
    }
    if (!response.ok) throw await responseError(response);
    const mode = parseMode(await response.json());
    if (mode.runId !== runId) {
      throw new ObserverModeClientError(
        "INVALID_OBSERVER_MODE_RESPONSE",
        "The controller returned observer state for another run.",
      );
    }
    return mode;
  }
}

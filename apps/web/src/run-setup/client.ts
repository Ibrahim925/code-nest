import type { RunControlView, RunSetupConfiguration } from "./domain.js";
import { browserFetch } from "../http/browser-fetch.js";

export type RunMutation = "pause" | "resume" | "cancel";

export interface OperatorRunClient {
  start(configuration: RunSetupConfiguration): Promise<RunControlView>;
  mutate(runId: string, action: RunMutation): Promise<RunControlView>;
}

export class OperatorClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OperatorClientError";
  }
}

interface HttpOperatorRunClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetcher?: typeof fetch;
  readonly createCommandId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRunView(value: unknown): RunControlView {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "1.0" ||
    typeof value.runId !== "string" ||
    !["running", "paused", "cancelled"].includes(String(value.status)) ||
    !(value.terminalReason === null || value.terminalReason === "operator_cancelled") ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Number.isSafeInteger(value.lastEventSequence)
  ) {
    throw new OperatorClientError(
      "INVALID_CONTROLLER_RESPONSE",
      "The controller returned an invalid run state.",
    );
  }
  return value as unknown as RunControlView;
}

async function responseError(response: Response): Promise<OperatorClientError> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return new OperatorClientError(
      "CONTROLLER_REQUEST_FAILED",
      `The controller returned HTTP ${response.status}.`,
    );
  }
  const error = isRecord(value) && isRecord(value.error) ? value.error : undefined;
  return new OperatorClientError(
    typeof error?.code === "string" ? error.code : "CONTROLLER_REQUEST_FAILED",
    typeof error?.message === "string"
      ? error.message
      : `The controller returned HTTP ${response.status}.`,
  );
}

export class HttpOperatorRunClient implements OperatorRunClient {
  readonly #fetch: typeof fetch;
  readonly #createCommandId: () => string;

  constructor(private readonly options: HttpOperatorRunClientOptions) {
    this.#fetch = browserFetch(options.fetcher);
    this.#createCommandId = options.createCommandId ?? (() => crypto.randomUUID());
  }

  start(configuration: RunSetupConfiguration): Promise<RunControlView> {
    return this.#request("/runs", {
      method: "POST",
      body: JSON.stringify({
        runId: configuration.runId,
        configuration,
      }),
    });
  }

  mutate(runId: string, action: RunMutation): Promise<RunControlView> {
    return this.#request(`/runs/${encodeURIComponent(runId)}/${action}`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async #request(path: string, init: RequestInit): Promise<RunControlView> {
    if (this.options.token.trim().length === 0) {
      throw new OperatorClientError(
        "MISSING_OPERATOR_TOKEN",
        "Enter the local operator token before sending a control request.",
      );
    }
    const commandId = this.#createCommandId();
    let response: Response;
    try {
      response = await this.#fetch(`${this.options.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
          "idempotency-key": commandId,
        },
      });
    } catch {
      throw new OperatorClientError(
        "CONTROLLER_UNREACHABLE",
        "The local controller could not be reached. Check that it is running.",
      );
    }
    if (!response.ok) throw await responseError(response);
    return parseRunView(await response.json());
  }
}

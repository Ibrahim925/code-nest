import {
  parseReplayBundle,
  serializeReplayBundle,
  type ReplayBundle,
} from "@code-nest/protocol";
import { browserFetch } from "../../http/browser-fetch.js";

export class ReplayClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ReplayClientError";
  }
}

export interface ReplayClient {
  export(runId: string, signal?: AbortSignal): Promise<ReplayBundle>;
}

export class HttpReplayClient implements ReplayClient {
  readonly #fetch: typeof fetch;

  constructor(private readonly options: {
    readonly baseUrl: string;
    readonly bearerToken: string;
    readonly fetcher?: typeof fetch;
  }) {
    this.#fetch = browserFetch(options.fetcher);
  }

  async export(runId: string, signal?: AbortSignal): Promise<ReplayBundle> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.options.baseUrl}/runs/${encodeURIComponent(runId)}/replay`,
        {
          method: "GET",
          headers: {
            accept: "application/vnd.code-nest.replay+json",
            authorization: `Bearer ${this.options.bearerToken}`,
            "x-code-nest-observer-view": "1",
          },
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error;
      throw new ReplayClientError("REPLAY_NETWORK_ERROR", "Replay export could not be reached.");
    }
    if (!response.ok) {
      const code = response.status === 409 ? "RUN_NOT_TERMINAL" :
        response.status === 401 ? "UNAUTHORIZED" : "REPLAY_UNAVAILABLE";
      throw new ReplayClientError(
        code,
        code === "RUN_NOT_TERMINAL"
          ? "Replay export is available after completion or cancellation."
          : "Replay export is unavailable.",
      );
    }
    let input: unknown;
    try {
      input = await response.json();
    } catch {
      throw new ReplayClientError("INVALID_REPLAY_BUNDLE", "Replay export is not valid JSON.");
    }
    const parsed = parseReplayBundle(input);
    if (!parsed.ok) throw new ReplayClientError(parsed.error.code, parsed.error.message);
    return parsed.value;
  }
}

export function downloadReplayBundle(bundle: ReplayBundle): void {
  const blob = new Blob([serializeReplayBundle(bundle)], {
    type: "application/vnd.code-nest.replay+json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${bundle.runId}.replay.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

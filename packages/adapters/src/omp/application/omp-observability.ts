import { RuntimeAdapterError } from "../../contract.js";

export type OmpActivityState =
  | "starting"
  | "working"
  | "waiting"
  | "paused"
  | "stopped"
  | "failed";

export type OmpCaptureReason =
  | "action"
  | "heartbeat"
  | "phase_boundary"
  | "operator_request";

export type OmpComputerCapture =
  | {
      readonly status: "visible";
      readonly bytes: Uint8Array;
      readonly width: number;
      readonly height: number;
      readonly redactionStatus: "clear" | "redacted";
    }
  | {
      readonly status: "withheld";
      readonly reason: "suspected_secret" | "capture_failed" | "policy";
    };

export interface OmpComputerCapturePort {
  capture(reason: OmpCaptureReason): Promise<OmpComputerCapture>;
}

export type OmpObservabilityFact =
  | {
      readonly observationId: string;
      readonly source: "runtime";
      readonly observation: {
        readonly kind: "activity";
        readonly state: OmpActivityState;
        readonly summary: string;
      };
    }
  | {
      readonly observationId: string;
      readonly source: "runtime";
      readonly observation: {
        readonly kind: "tool";
        readonly toolCallId: string;
        readonly toolName: string;
        readonly status: "started" | "completed" | "failed";
        readonly summary: null;
      };
    }
  | {
      readonly observationId: string;
      readonly source: "participant";
      readonly observation: { readonly kind: "rationale"; readonly body: string };
    }
  | {
      readonly observationId: string;
      readonly source: "participant";
      readonly observation: {
        readonly kind: "memory";
        readonly reason: "agent_consolidation" | "round_transition" | "resume";
        readonly summary: string;
        readonly content: string;
      };
    }
  | {
      readonly observationId: string;
      readonly source: "runtime";
      readonly observation: {
        readonly kind: "computer_frame";
        readonly frameId: string;
        readonly captureReason: OmpCaptureReason;
        readonly frameSequence: number;
        readonly frame: OmpComputerCapture;
      };
    };

export interface OmpObservabilitySink {
  record(fact: OmpObservabilityFact): Promise<void>;
}

export interface OmpObservabilityOptions {
  readonly sink?: OmpObservabilitySink;
  readonly computerCapture?: OmpComputerCapturePort;
  readonly heartbeatMilliseconds?: number;
}

const ACTIVITY_SUMMARIES: Record<OmpActivityState, string> = {
  starting: "Starting the OMP participant runtime.",
  working: "Working on the current turn.",
  waiting: "Waiting for the next controller observation.",
  paused: "Paused by a controller interruption.",
  stopped: "OMP participant runtime stopped.",
  failed: "OMP participant runtime failed.",
};
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function safeCapture(frame: OmpComputerCapture): OmpComputerCapture {
  if (frame.status === "withheld") return frame;
  const valid =
    frame.bytes.byteLength >= PNG_SIGNATURE.length &&
    frame.bytes.byteLength <= 16_777_216 &&
    PNG_SIGNATURE.every((byte, index) => frame.bytes[index] === byte) &&
    Number.isSafeInteger(frame.width) &&
    frame.width >= 1 &&
    frame.width <= 7_680 &&
    Number.isSafeInteger(frame.height) &&
    frame.height >= 1 &&
    frame.height <= 4_320;
  return valid
    ? { ...frame, bytes: Uint8Array.from(frame.bytes) }
    : { status: "withheld", reason: "capture_failed" };
}

export class OmpObservabilityBridge {
  readonly #sink: OmpObservabilitySink | undefined;
  readonly #capturePort: OmpComputerCapturePort | undefined;
  readonly #heartbeatMilliseconds: number;
  #pending: Promise<void> = Promise.resolve();
  #heartbeat: ReturnType<typeof setInterval> | undefined;
  #observationIndex = 0;
  #frameSequence = 0;

  constructor(options: OmpObservabilityOptions = {}) {
    this.#sink = options.sink;
    this.#capturePort = options.computerCapture;
    this.#heartbeatMilliseconds = options.heartbeatMilliseconds ?? 10_000;
    if (
      !Number.isSafeInteger(this.#heartbeatMilliseconds) ||
      this.#heartbeatMilliseconds < 1_000 ||
      this.#heartbeatMilliseconds > 60_000
    ) {
      throw new RuntimeAdapterError(
        "INVALID_ADAPTER_INPUT",
        "OMP capture heartbeat must be between 1000 and 60000 milliseconds.",
      );
    }
  }

  activity(state: OmpActivityState): void {
    this.#record({
      source: "runtime",
      observation: {
        kind: "activity",
        state,
        summary: ACTIVITY_SUMMARIES[state],
      },
    });
  }

  tool(event: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly status: "started" | "completed" | "failed";
  }): void {
    this.#record({
      source: "runtime",
      observation: { kind: "tool", ...event, summary: null },
    });
    this.capture("action");
  }

  rationale(body: string): void {
    this.#record({
      source: "participant",
      observation: { kind: "rationale", body },
    });
  }

  memory(update: {
    readonly reason: "agent_consolidation" | "round_transition" | "resume";
    readonly summary: string;
    readonly content: string;
  }): void {
    this.#record({
      source: "participant",
      observation: { kind: "memory", ...update },
    });
  }

  capture(reason: OmpCaptureReason): void {
    if (this.#sink === undefined) return;
    this.#enqueue(async () => {
      let frame: OmpComputerCapture;
      if (this.#capturePort === undefined) {
        frame = { status: "withheld", reason: "policy" };
      } else {
        try {
          frame = safeCapture(await this.#capturePort.capture(reason));
        } catch {
          frame = { status: "withheld", reason: "capture_failed" };
        }
      }
      const frameSequence = ++this.#frameSequence;
      await this.#send({
        source: "runtime",
        observation: {
          kind: "computer_frame",
          frameId: `omp-frame-${frameSequence}`,
          captureReason: reason,
          frameSequence,
          frame,
        },
      });
    });
  }

  startHeartbeat(): void {
    if (this.#sink === undefined || this.#heartbeat !== undefined) return;
    this.#heartbeat = setInterval(
      () => this.capture("heartbeat"),
      this.#heartbeatMilliseconds,
    );
    this.#heartbeat.unref();
  }

  stopHeartbeat(): void {
    if (this.#heartbeat === undefined) return;
    clearInterval(this.#heartbeat);
    this.#heartbeat = undefined;
  }

  async flush(): Promise<void> {
    await this.#pending;
  }

  #record(
    fact: Omit<OmpObservabilityFact, "observationId">,
  ): void {
    if (this.#sink === undefined) return;
    this.#enqueue(() => this.#send(fact));
  }

  #send(fact: Omit<OmpObservabilityFact, "observationId">): Promise<void> {
    const observationId = `omp-live-${++this.#observationIndex}`;
    return this.#sink?.record({ observationId, ...fact } as OmpObservabilityFact) ??
      Promise.resolve();
  }

  #enqueue(operation: () => Promise<void>): void {
    this.#pending = this.#pending.then(operation);
  }
}

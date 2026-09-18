import type {
  DecodedEventDelivery,
  LiveConnectionState,
  RecoveryReason,
} from "../domain/live-events.js";
import {
  EventStreamTransportError,
  type EventDeliveryDecoder,
  type EventStreamTransport,
} from "./ports/event-stream.js";

export interface LiveEventObserver {
  readonly onDelivery: (delivery: DecodedEventDelivery) => void;
  readonly onState: (state: LiveConnectionState) => void;
}

export interface FollowLiveEventsRequest {
  readonly runId: string;
  readonly bearerToken: string;
  readonly signal: AbortSignal;
}

export interface LiveEventClientDependencies {
  readonly transport: EventStreamTransport;
  readonly decoder: EventDeliveryDecoder;
  readonly waitBeforeReconnect?: (attempt: number, signal: AbortSignal) => Promise<void>;
  readonly maximumReconnectAttempts?: number;
}

export class LiveEventClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LiveEventClientError";
  }
}

const defaultWait = (attempt: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(
      finish,
      Math.min(250 * 2 ** (attempt - 1), 4_000),
    );
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });

function asClientError(error: unknown): LiveEventClientError {
  if (error instanceof LiveEventClientError) return error;
  if (error instanceof EventStreamTransportError && !error.recoverable) {
    return new LiveEventClientError(error.code, error.message);
  }
  return new LiveEventClientError(
    "INVALID_EVENT_DELIVERY",
    "The controller sent an invalid live event delivery.",
  );
}

export class LiveEventClient {
  readonly #wait: (attempt: number, signal: AbortSignal) => Promise<void>;
  readonly #maximumAttempts: number;

  constructor(private readonly dependencies: LiveEventClientDependencies) {
    this.#wait = dependencies.waitBeforeReconnect ?? defaultWait;
    this.#maximumAttempts = dependencies.maximumReconnectAttempts ?? 8;
    if (!Number.isSafeInteger(this.#maximumAttempts) || this.#maximumAttempts < 1) {
      throw new Error("Live event client requires at least one reconnect attempt.");
    }
  }

  async follow(
    request: FollowLiveEventsRequest,
    observer: LiveEventObserver,
  ): Promise<void> {
    let lastEventId: string | undefined;
    let nextDeliverySequence = 1;
    let reconnectAttempts = 0;
    const accepted = new Map<string, number>();

    observer.onState({ status: "connecting", attempt: 1, lastEventId: null });
    while (!request.signal.aborted) {
      let recoveryReason: RecoveryReason = "transport_closed";
      try {
        const stream = await this.dependencies.transport.open({
          runId: request.runId,
          bearerToken: request.bearerToken,
          ...(lastEventId === undefined ? {} : { lastEventId }),
          signal: request.signal,
        });
        observer.onState({
          status: "live",
          lastEventId: lastEventId ?? null,
          nextDeliverySequence,
        });

        for await (const frame of stream) {
          if (request.signal.aborted) break;
          const delivery = this.dependencies.decoder.decode(frame);
          const priorSequence = accepted.get(delivery.eventId);
          if (priorSequence !== undefined) {
            if (priorSequence !== delivery.deliverySequence) {
              throw new LiveEventClientError(
                "EVENT_ID_CONFLICT",
                "A live event identifier was reused for another sequence.",
              );
            }
            continue;
          }
          if (delivery.deliverySequence > nextDeliverySequence) {
            recoveryReason = "sequence_gap";
            break;
          }
          if (delivery.deliverySequence < nextDeliverySequence) {
            throw new LiveEventClientError(
              "DELIVERY_SEQUENCE_CONFLICT",
              "The live event stream returned an unexpected prior sequence.",
            );
          }

          accepted.set(delivery.eventId, delivery.deliverySequence);
          lastEventId = delivery.eventId;
          nextDeliverySequence += 1;
          reconnectAttempts = 0;
          try {
            observer.onDelivery(delivery);
          } catch {
            throw new LiveEventClientError(
              "EVENT_OBSERVER_FAILED",
              "The live event consumer could not accept a delivery.",
            );
          }
        }
      } catch (error: unknown) {
        if (request.signal.aborted) break;
        if (
          error instanceof LiveEventClientError ||
          (error instanceof EventStreamTransportError && !error.recoverable)
        ) {
          const failure = asClientError(error);
          observer.onState({
            status: "failed",
            code: failure.code,
            message: failure.message,
            lastEventId: lastEventId ?? null,
          });
          return;
        }
        recoveryReason = "transport_error";
      }

      if (request.signal.aborted) break;
      reconnectAttempts += 1;
      if (reconnectAttempts > this.#maximumAttempts) {
        observer.onState({
          status: "failed",
          code: "EVENT_STREAM_UNAVAILABLE",
          message: "The live event stream could not be recovered.",
          lastEventId: lastEventId ?? null,
        });
        return;
      }
      observer.onState({
        status: "recovering",
        reason: recoveryReason,
        attempt: reconnectAttempts,
        lastEventId: lastEventId ?? null,
        nextDeliverySequence,
      });
      await this.#wait(reconnectAttempts, request.signal);
    }

    observer.onState({
      status: "stopped",
      lastEventId: lastEventId ?? null,
      nextDeliverySequence,
    });
  }
}

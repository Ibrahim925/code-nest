import {
  LiveEventClient,
  type LiveEventClientDependencies,
} from "./application/live-event-client.js";
import { FetchSseTransport } from "./http/fetch-sse-transport.js";
import { ProtocolEventDeliveryDecoder } from "./protocol/protocol-event-delivery-decoder.js";

export interface CreateLiveEventClientOptions {
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
  readonly waitBeforeReconnect?: LiveEventClientDependencies["waitBeforeReconnect"];
  readonly maximumReconnectAttempts?: number;
}

export function createLiveEventClient(
  options: CreateLiveEventClientOptions,
): LiveEventClient {
  return new LiveEventClient({
    transport: new FetchSseTransport({
      baseUrl: options.baseUrl,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    }),
    decoder: new ProtocolEventDeliveryDecoder(),
    ...(options.waitBeforeReconnect === undefined
      ? {}
      : { waitBeforeReconnect: options.waitBeforeReconnect }),
    ...(options.maximumReconnectAttempts === undefined
      ? {}
      : { maximumReconnectAttempts: options.maximumReconnectAttempts }),
  });
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { CredentialBrokerService } from "../application/credential-broker.ts";
import { CredentialBrokerError } from "../domain/broker-contract.ts";

export interface CredentialBrokerServer {
  readonly port: number;
  close(): Promise<void>;
}

function header(value: string | readonly string[] | undefined): string | null {
  return typeof value === "string" && value.length <= 512 && !/[\r\n\0]/u.test(value)
    ? value
    : null;
}

function body(request: IncomingMessage, maximumBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        request.removeAllListeners("data");
        request.resume();
        reject(new CredentialBrokerError("BROKER_BODY_TOO_LARGE", "Broker request body is too large."));
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function status(error: unknown): number {
  if (!(error instanceof CredentialBrokerError)) return 500;
  switch (error.code) {
    case "BROKER_UNAUTHORIZED": return 401;
    case "BROKER_FORBIDDEN": return 403;
    case "BROKER_BODY_TOO_LARGE": return 413;
    case "INVALID_BROKER_INPUT": return 400;
    case "BROKER_UPSTREAM_FAILED": return 502;
  }
}

function safeError(response: ServerResponse, error: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status(error), {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify({ error: "credential_broker_request_failed" }));
}

function route(request: IncomingMessage): {
  readonly providerId: string;
  readonly path: string;
} | null {
  if (request.url === undefined) return null;
  const url = new URL(request.url, "http://credential-broker.invalid");
  const match = /^\/v1\/providers\/([a-z0-9][a-z0-9._-]{0,63})(\/.*)$/u.exec(url.pathname);
  return match === null || match[1] === undefined || match[2] === undefined
    ? null
    : { providerId: match[1], path: `${match[2]}${url.search}` };
}

async function handle(
  service: CredentialBrokerService,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/health/live") {
    response.writeHead(204, { "cache-control": "no-store" });
    response.end();
    return;
  }
  const target = route(request);
  const authorization = header(request.headers.authorization);
  const token = authorization?.startsWith("Bearer ") === true
    ? authorization.slice("Bearer ".length)
    : "";
  if (
    target === null || (request.method !== "GET" && request.method !== "POST") ||
    token.length === 0
  ) throw new CredentialBrokerError("BROKER_UNAUTHORIZED", "Broker request is not authorized.");
  const result = await service.proxy({
    token,
    providerId: target.providerId,
    method: request.method,
    path: target.path,
    contentType: header(request.headers["content-type"]),
    accept: header(request.headers.accept),
    body: await body(request, service.maximumRequestBytes()),
  });
  response.writeHead(result.status, {
    "cache-control": "no-store",
    "content-type": result.contentType ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
    ...(result.requestId === null ? {} : { "x-provider-request-id": result.requestId }),
  });
  response.end(result.body);
}

export function startCredentialBrokerServer(
  service: CredentialBrokerService,
  options: { readonly host: string; readonly port: number },
): Promise<CredentialBrokerServer> {
  return new Promise((resolve, reject) => {
    const server = createServer({
      headersTimeout: 5_000,
      maxHeaderSize: 16 * 1_024,
      requestTimeout: 120_000,
    }, (request, response) => void handle(service, request, response).catch((error: unknown) => {
      safeError(response, error);
    }));
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () => new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
        }),
      });
    });
  });
}

import { request as httpsRequest } from "node:https";

import { CredentialBrokerError, type BrokerProxyResponse } from "../domain/broker-contract.ts";
import type {
  ProviderTransport,
  ProviderTransportRequest,
} from "../application/credential-broker.ts";

function singleHeader(value: string | readonly string[] | undefined): string | null {
  return typeof value === "string" && value.length <= 512 && !/[\r\n\0]/u.test(value)
    ? value
    : null;
}

export class HttpsProviderTransport implements ProviderTransport {
  send(input: ProviderTransportRequest): Promise<BrokerProxyResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL(input.url);
      if (url.protocol !== "https:") {
        reject(new CredentialBrokerError("BROKER_UPSTREAM_FAILED", "Provider transport requires HTTPS."));
        return;
      }
      const request = httpsRequest(url, {
        method: input.method,
        headers: { ...input.headers },
        ...(input.certificateAuthority === undefined ? {} : { ca: input.certificateAuthority }),
      }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > input.maximumResponseBytes) {
            request.destroy(new CredentialBrokerError(
              "BROKER_BODY_TOO_LARGE",
              "Provider response exceeded its byte limit.",
            ));
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => {
          const status = response.statusCode ?? 502;
          resolve({
            status,
            contentType: singleHeader(response.headers["content-type"]),
            requestId: singleHeader(response.headers["x-request-id"]),
            body: Buffer.concat(chunks),
          });
        });
      });
      request.once("error", reject);
      request.setTimeout(input.timeoutMilliseconds, () => {
        request.destroy(new CredentialBrokerError(
          "BROKER_UPSTREAM_FAILED",
          "Provider request exceeded its deadline.",
        ));
      });
      if (input.method === "POST" && input.body.byteLength > 0) request.write(input.body);
      request.end();
    });
  }
}

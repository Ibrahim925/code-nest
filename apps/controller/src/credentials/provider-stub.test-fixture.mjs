import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import process from "node:process";

const expectedCredential = process.env.EXPECTED_PROVIDER_CREDENTIAL;
delete process.env.EXPECTED_PROVIDER_CREDENTIAL;
if (expectedCredential === undefined) throw new Error("Expected credential is missing.");

const server = createServer({
  key: readFileSync("/opt/code-nest/tls/key.pem"),
  cert: readFileSync("/opt/code-nest/tls/cert.pem"),
}, (request, response) => {
  if (request.url === "/health/live") {
    response.writeHead(204);
    response.end();
    return;
  }
  const chunks = [];
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.byteLength;
    if (bytes <= 1024 * 1024) chunks.push(chunk);
  });
  request.on("end", () => {
    const authorized = request.headers.authorization === expectedCredential;
    const body = Buffer.concat(chunks);
    response.writeHead(authorized ? 200 : 401, {
      "content-type": "application/json",
      "x-request-id": "provider-stub-request",
    });
    response.end(JSON.stringify({
      authorized,
      method: request.method,
      path: request.url,
      requestBytes: body.byteLength,
    }));
    process.stdout.write(`${JSON.stringify({
      kind: "provider_request",
      authorized,
      requestBytes: body.byteLength,
    })}\n`);
  });
});

server.listen(8443, "0.0.0.0", () => {
  process.stdout.write(`${JSON.stringify({ kind: "provider_ready", port: 8443 })}\n`);
});

function stop() {
  server.close(() => { process.exitCode = 0; });
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

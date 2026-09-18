import { afterEach, describe, expect, it } from "vitest";

import {
  CredentialBrokerError,
  CredentialBrokerService,
  MemoryBrokerAuditSink,
  startCredentialBrokerServer,
  type BrokerProxyResponse,
  type CredentialBrokerConfiguration,
  type CredentialBrokerServer,
  type ProviderTransport,
  type ProviderTransportRequest,
} from "./index.ts";

const TOKEN = "participant_capability_token_0123456789abcdef";
const LONG_CREDENTIAL = "Bearer provider-long-lived-secret";
const BODY_MARKER = "prompt-body-must-not-be-audited";

function configuration(overrides: Partial<CredentialBrokerConfiguration> = {}): CredentialBrokerConfiguration {
  return {
    schemaVersion: "1.0",
    providers: [{
      providerId: "provider-a",
      baseUrl: "https://provider.example/api/",
      allowedPathPrefixes: ["/v1/messages"],
      credentialHeader: "authorization",
      credentialValue: LONG_CREDENTIAL,
    }],
    grants: [{
      grantId: "grant-a",
      token: TOKEN,
      runId: "run-a",
      participantId: "participant-a",
      providerId: "provider-a",
      expiresAt: "2030-01-01T00:00:00.000Z",
    }],
    maximumRequestBytes: 1_024,
    maximumResponseBytes: 2_048,
    upstreamTimeoutMilliseconds: 1_000,
    ...overrides,
  };
}

class RecordingTransport implements ProviderTransport {
  readonly requests: ProviderTransportRequest[] = [];
  response: BrokerProxyResponse = {
    status: 200,
    contentType: "application/json",
    requestId: "provider-request-a",
    body: Buffer.from('{"ok":true}'),
  };

  async send(request: ProviderTransportRequest): Promise<BrokerProxyResponse> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.response);
  }
}

const servers: CredentialBrokerServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("credential broker", () => {
  it("forwards only an allowed scoped request and attaches the provider credential", async () => {
    const transport = new RecordingTransport();
    const audit = new MemoryBrokerAuditSink();
    const service = new CredentialBrokerService(
      configuration(),
      transport,
      audit,
      { now: () => new Date("2029-01-01T00:00:00.000Z") },
    );

    const response = await service.proxy({
      token: TOKEN,
      providerId: "provider-a",
      method: "POST",
      path: "/v1/messages?version=1",
      contentType: "application/json",
      accept: "application/json",
      body: Buffer.from(BODY_MARKER),
    });

    expect(response).toMatchObject({ status: 200, requestId: "provider-request-a" });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({
      url: "https://provider.example/api/v1/messages?version=1",
      headers: {
        authorization: LONG_CREDENTIAL,
        accept: "application/json",
        "content-type": "application/json",
      },
    });
    const serializedAudit = JSON.stringify(audit.records());
    expect(audit.records()).toEqual([expect.objectContaining({
      outcome: "allowed",
      grantId: "grant-a",
      participantId: "participant-a",
      path: "/v1/messages?version=1",
      requestBytes: Buffer.byteLength(BODY_MARKER),
      responseBytes: 11,
      upstreamStatus: 200,
    })]);
    expect(serializedAudit).not.toContain(BODY_MARKER);
    expect(serializedAudit).not.toContain(TOKEN);
    expect(serializedAudit).not.toContain(LONG_CREDENTIAL);
  });

  it("rejects wrong, expired, cross-provider, and unapproved requests before transport", async () => {
    const transport = new RecordingTransport();
    const audit = new MemoryBrokerAuditSink();
    const service = new CredentialBrokerService(
      configuration(),
      transport,
      audit,
      { now: () => new Date("2031-01-01T00:00:00.000Z") },
    );
    const base = {
      token: TOKEN,
      providerId: "provider-a",
      method: "POST" as const,
      path: "/v1/messages",
      contentType: "application/json",
      accept: null,
      body: new Uint8Array(),
    };

    await expect(service.proxy({ ...base, token: "x".repeat(40) }))
      .rejects.toMatchObject({ code: "BROKER_UNAUTHORIZED" });
    await expect(service.proxy(base)).rejects.toMatchObject({ code: "BROKER_UNAUTHORIZED" });
    const active = new CredentialBrokerService(
      configuration(), transport, audit, { now: () => new Date("2029-01-01T00:00:00.000Z") },
    );
    await expect(active.proxy({ ...base, providerId: "provider-b" }))
      .rejects.toMatchObject({ code: "BROKER_FORBIDDEN" });
    await expect(active.proxy({ ...base, path: "/v1/files" }))
      .rejects.toMatchObject({ code: "BROKER_FORBIDDEN" });
    expect(transport.requests).toHaveLength(0);
    expect(audit.records()).toHaveLength(4);
  });

  it("bounds bodies and converts upstream failures to safe errors", async () => {
    const transport: ProviderTransport = {
      send: () => Promise.reject(new Error("provider credential appeared only in internal cause")),
    };
    const audit = new MemoryBrokerAuditSink();
    const service = new CredentialBrokerService(
      configuration({ maximumRequestBytes: 4 }),
      transport,
      audit,
      { now: () => new Date("2029-01-01T00:00:00.000Z") },
    );
    const base = {
      token: TOKEN,
      providerId: "provider-a",
      method: "POST" as const,
      path: "/v1/messages",
      contentType: null,
      accept: null,
    };
    await expect(service.proxy({ ...base, body: Buffer.from("oversized") }))
      .rejects.toMatchObject({ code: "BROKER_BODY_TOO_LARGE" });
    await expect(service.proxy({ ...base, body: Buffer.from("safe") }))
      .rejects.toEqual(expect.objectContaining({
        code: "BROKER_UPSTREAM_FAILED",
        message: "Approved provider request failed.",
      }));
    expect(JSON.stringify(audit.records())).not.toContain("internal cause");
  });

  it("serves the bounded authenticated HTTP gateway without reflecting errors", async () => {
    const transport = new RecordingTransport();
    const audit = new MemoryBrokerAuditSink();
    const service = new CredentialBrokerService(
      configuration(), transport, audit, { now: () => new Date("2029-01-01T00:00:00.000Z") },
    );
    const server = await startCredentialBrokerServer(service, { host: "127.0.0.1", port: 0 });
    servers.push(server);

    const accepted = await fetch(`http://127.0.0.1:${server.port}/v1/providers/provider-a/v1/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: BODY_MARKER,
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe('{"ok":true}');
    const rejected = await fetch(`http://127.0.0.1:${server.port}/v1/providers/provider-a/v1/messages`, {
      method: "POST",
      headers: { authorization: "Bearer invalid_invalid_invalid_invalid" },
      body: BODY_MARKER,
    });
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ error: "credential_broker_request_failed" });
  });

  it("rejects unsafe provider configuration before serving", () => {
    expect(() => new CredentialBrokerService(
      configuration({ providers: [{
        providerId: "provider-a",
        baseUrl: "http://provider.example/",
        allowedPathPrefixes: ["/v1"],
        credentialHeader: "host",
        credentialValue: "secret\nsecond-header: value",
      }] }),
      new RecordingTransport(),
      new MemoryBrokerAuditSink(),
    )).toThrow(CredentialBrokerError);
  });
});

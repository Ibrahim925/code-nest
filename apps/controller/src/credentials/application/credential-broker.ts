import {
  BROKER_SCHEMA_VERSION,
  CredentialBrokerError,
  grantForToken,
  normalizeCredentialBrokerConfiguration,
  providerPathAllowed,
  type BrokerAuditRecord,
  type BrokerProxyRequest,
  type BrokerProxyResponse,
  type CredentialBrokerConfiguration,
  type NormalizedBrokerProvider,
} from "../domain/broker-contract.ts";

export interface ProviderTransportRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly certificateAuthority?: string;
  readonly timeoutMilliseconds: number;
  readonly maximumResponseBytes: number;
}

export interface ProviderTransport {
  send(request: ProviderTransportRequest): Promise<BrokerProxyResponse>;
}

export interface BrokerAuditSink {
  append(record: BrokerAuditRecord): Promise<void>;
}

export interface BrokerClock {
  now(): Date;
}

function denied(code: "BROKER_FORBIDDEN" | "BROKER_UNAUTHORIZED", message: string): never {
  throw new CredentialBrokerError(code, message);
}

function providerUrl(provider: NormalizedBrokerProvider, path: string): string {
  const base = provider.baseUrl.endsWith("/") ? provider.baseUrl : `${provider.baseUrl}/`;
  const url = new URL(path.replace(/^\//u, ""), base);
  if (url.origin !== provider.origin) return denied("BROKER_FORBIDDEN", "Provider path is not allowed.");
  return url.toString();
}

export class CredentialBrokerService {
  readonly #configuration;

  constructor(
    configuration: CredentialBrokerConfiguration,
    private readonly transport: ProviderTransport,
    private readonly audit: BrokerAuditSink,
    private readonly clock: BrokerClock = { now: () => new Date() },
  ) {
    this.#configuration = normalizeCredentialBrokerConfiguration(configuration);
  }

  maximumRequestBytes(): number {
    return this.#configuration.maximumRequestBytes;
  }

  async proxy(request: BrokerProxyRequest): Promise<BrokerProxyResponse> {
    const startedAt = this.clock.now();
    const grant = grantForToken(this.#configuration.grants, request.token);
    let outcome: BrokerAuditRecord["outcome"] = "denied";
    let status: number | null = null;
    let responseBytes = 0;
    try {
      if (grant === undefined || grant.expiresAtMilliseconds <= startedAt.getTime()) {
        return denied("BROKER_UNAUTHORIZED", "Broker capability is invalid or expired.");
      }
      if (grant.providerId !== request.providerId) {
        return denied("BROKER_FORBIDDEN", "Broker capability does not allow this provider.");
      }
      const provider = this.#configuration.providers.find(({ providerId }) =>
        providerId === request.providerId
      );
      if (provider === undefined || !providerPathAllowed(request.path, provider.allowedPathPrefixes)) {
        return denied("BROKER_FORBIDDEN", "Provider path is not allowed.");
      }
      if (request.body.byteLength > this.#configuration.maximumRequestBytes) {
        throw new CredentialBrokerError("BROKER_BODY_TOO_LARGE", "Broker request body is too large.");
      }
      const headers: Record<string, string> = {
        [provider.credentialHeader]: provider.credentialValue,
        "user-agent": "code-nest-credential-broker/1.0",
      };
      if (request.contentType !== null) headers["content-type"] = request.contentType;
      if (request.accept !== null) headers.accept = request.accept;
      let response: BrokerProxyResponse;
      try {
        response = await this.transport.send({
          url: providerUrl(provider, request.path),
          method: request.method,
          headers,
          body: request.body,
          ...(provider.certificateAuthority === undefined
            ? {} : { certificateAuthority: provider.certificateAuthority }),
          timeoutMilliseconds: this.#configuration.upstreamTimeoutMilliseconds,
          maximumResponseBytes: this.#configuration.maximumResponseBytes,
        });
      } catch (error: unknown) {
        outcome = "upstream_failed";
        throw new CredentialBrokerError(
          "BROKER_UPSTREAM_FAILED",
          "Approved provider request failed.",
          error,
        );
      }
      status = response.status;
      responseBytes = response.body.byteLength;
      outcome = "allowed";
      return {
        status: response.status,
        contentType: response.contentType,
        requestId: response.requestId,
        body: new Uint8Array(response.body),
      };
    } finally {
      await this.audit.append({
        schemaVersion: BROKER_SCHEMA_VERSION,
        outcome,
        grantId: grant?.grantId ?? null,
        runId: grant?.runId ?? null,
        participantId: grant?.participantId ?? null,
        providerId: request.providerId,
        method: request.method,
        path: request.path,
        requestBytes: request.body.byteLength,
        responseBytes,
        upstreamStatus: status,
        startedAt: startedAt.toISOString(),
        completedAt: this.clock.now().toISOString(),
      });
    }
  }
}

export class MemoryBrokerAuditSink implements BrokerAuditSink {
  readonly #records: BrokerAuditRecord[] = [];
  async append(record: BrokerAuditRecord): Promise<void> { this.#records.push(structuredClone(record)); }
  records(): readonly BrokerAuditRecord[] { return structuredClone(this.#records); }
}

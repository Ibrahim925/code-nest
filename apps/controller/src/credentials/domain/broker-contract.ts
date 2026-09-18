import { createHash, timingSafeEqual } from "node:crypto";

export const BROKER_SCHEMA_VERSION = "1.0" as const;

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HEADER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
const FORBIDDEN_HEADERS = new Set([
  "connection", "content-length", "cookie", "host", "proxy-authorization",
  "set-cookie", "te", "trailer", "transfer-encoding", "upgrade",
]);

export type CredentialBrokerErrorCode =
  | "BROKER_BODY_TOO_LARGE"
  | "BROKER_FORBIDDEN"
  | "BROKER_UNAUTHORIZED"
  | "BROKER_UPSTREAM_FAILED"
  | "INVALID_BROKER_INPUT";

export class CredentialBrokerError extends Error {
  constructor(
    readonly code: CredentialBrokerErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CredentialBrokerError";
  }
}

export interface BrokerProviderConfiguration {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly allowedPathPrefixes: readonly string[];
  readonly credentialHeader: string;
  readonly credentialValue: string;
  readonly certificateAuthority?: string;
}

export interface BrokerGrantConfiguration {
  readonly grantId: string;
  readonly token: string;
  readonly runId: string;
  readonly participantId: string;
  readonly providerId: string;
  readonly expiresAt: string;
}

export interface CredentialBrokerConfiguration {
  readonly schemaVersion: typeof BROKER_SCHEMA_VERSION;
  readonly providers: readonly BrokerProviderConfiguration[];
  readonly grants: readonly BrokerGrantConfiguration[];
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly upstreamTimeoutMilliseconds: number;
}

export interface NormalizedBrokerProvider extends BrokerProviderConfiguration {
  readonly credentialHeader: string;
  readonly origin: string;
}

export interface NormalizedBrokerGrant {
  readonly grantId: string;
  readonly tokenDigest: Uint8Array;
  readonly runId: string;
  readonly participantId: string;
  readonly providerId: string;
  readonly expiresAt: string;
  readonly expiresAtMilliseconds: number;
}

export interface NormalizedCredentialBrokerConfiguration {
  readonly schemaVersion: typeof BROKER_SCHEMA_VERSION;
  readonly providers: readonly NormalizedBrokerProvider[];
  readonly grants: readonly NormalizedBrokerGrant[];
  readonly maximumRequestBytes: number;
  readonly maximumResponseBytes: number;
  readonly upstreamTimeoutMilliseconds: number;
}

export interface BrokerProxyRequest {
  readonly token: string;
  readonly providerId: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly contentType: string | null;
  readonly accept: string | null;
  readonly body: Uint8Array;
}

export interface BrokerProxyResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly requestId: string | null;
  readonly body: Uint8Array;
}

export interface BrokerAuditRecord {
  readonly schemaVersion: typeof BROKER_SCHEMA_VERSION;
  readonly outcome: "allowed" | "denied" | "upstream_failed";
  readonly grantId: string | null;
  readonly runId: string | null;
  readonly participantId: string | null;
  readonly providerId: string;
  readonly method: string;
  readonly path: string;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly upstreamStatus: number | null;
  readonly startedAt: string;
  readonly completedAt: string;
}

function invalid(message: string): never {
  throw new CredentialBrokerError("INVALID_BROKER_INPUT", message);
}

function safePathPrefix(value: string): boolean {
  if (!value.startsWith("/") || value.length > 512 || value.includes("?") || value.includes("#")) return false;
  try {
    const decoded = decodeURIComponent(value);
    return !decoded.split("/").includes("..") && !decoded.includes("\0");
  } catch { return false; }
}

function normalizeProvider(input: BrokerProviderConfiguration): NormalizedBrokerProvider {
  if (!IDENTIFIER.test(input.providerId) || input.allowedPathPrefixes.length === 0) {
    return invalid("Broker provider identity and path allow-list are invalid.");
  }
  let url: URL;
  try { url = new URL(input.baseUrl); } catch { return invalid("Broker provider URL is invalid."); }
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.search !== "" || url.hash !== "" || !input.allowedPathPrefixes.every(safePathPrefix)
  ) return invalid("Broker provider must use a credential-free HTTPS base URL and safe path prefixes.");
  const header = input.credentialHeader.toLowerCase();
  if (
    !HEADER.test(header) || FORBIDDEN_HEADERS.has(header) || input.credentialValue.length === 0 ||
    input.credentialValue.length > 4_096 || /[\r\n\0]/u.test(input.credentialValue) ||
    (input.certificateAuthority !== undefined && input.certificateAuthority.length > 64 * 1_024)
  ) return invalid("Broker provider credential configuration is invalid.");
  return { ...input, credentialHeader: header, origin: url.origin };
}

function tokenDigest(token: string): Uint8Array {
  return createHash("sha256").update(token, "utf8").digest();
}

function normalizeGrant(input: BrokerGrantConfiguration): NormalizedBrokerGrant {
  const expiresAtMilliseconds = Date.parse(input.expiresAt);
  if (
    !IDENTIFIER.test(input.grantId) || !TOKEN.test(input.token) ||
    !IDENTIFIER.test(input.runId) || !IDENTIFIER.test(input.participantId) ||
    !IDENTIFIER.test(input.providerId) || !Number.isFinite(expiresAtMilliseconds)
  ) return invalid("Broker grant is invalid.");
  return {
    grantId: input.grantId,
    tokenDigest: tokenDigest(input.token),
    runId: input.runId,
    participantId: input.participantId,
    providerId: input.providerId,
    expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    expiresAtMilliseconds,
  };
}

export function normalizeCredentialBrokerConfiguration(
  input: CredentialBrokerConfiguration,
): NormalizedCredentialBrokerConfiguration {
  if (
    input.schemaVersion !== BROKER_SCHEMA_VERSION || input.providers.length === 0 ||
    input.providers.length > 16 || input.grants.length === 0 || input.grants.length > 64 ||
    !Number.isSafeInteger(input.maximumRequestBytes) || input.maximumRequestBytes < 1 ||
    input.maximumRequestBytes > 16 * 1_048_576 ||
    !Number.isSafeInteger(input.maximumResponseBytes) || input.maximumResponseBytes < 1 ||
    input.maximumResponseBytes > 16 * 1_048_576 ||
    !Number.isSafeInteger(input.upstreamTimeoutMilliseconds) ||
    input.upstreamTimeoutMilliseconds < 10 || input.upstreamTimeoutMilliseconds > 120_000
  ) return invalid("Broker configuration is invalid or outside supported limits.");
  const providers = input.providers.map(normalizeProvider);
  const grants = input.grants.map(normalizeGrant);
  if (
    new Set(providers.map(({ providerId }) => providerId)).size !== providers.length ||
    new Set(grants.map(({ grantId }) => grantId)).size !== grants.length ||
    new Set(input.grants.map(({ token }) => token)).size !== input.grants.length ||
    grants.some(({ providerId }) => !providers.some((provider) => provider.providerId === providerId))
  ) return invalid("Broker providers and grants must be unique and referentially valid.");
  return {
    schemaVersion: BROKER_SCHEMA_VERSION,
    providers,
    grants,
    maximumRequestBytes: input.maximumRequestBytes,
    maximumResponseBytes: input.maximumResponseBytes,
    upstreamTimeoutMilliseconds: input.upstreamTimeoutMilliseconds,
  };
}

export function grantForToken(
  grants: readonly NormalizedBrokerGrant[],
  token: string,
): NormalizedBrokerGrant | undefined {
  if (!TOKEN.test(token)) return undefined;
  const digest = tokenDigest(token);
  return grants.find((grant) => timingSafeEqual(grant.tokenDigest, digest));
}

export function providerPathAllowed(path: string, prefixes: readonly string[]): boolean {
  if (!safePathPrefix(path.split("?", 1)[0] ?? "")) return false;
  const pathname = path.split("?", 1)[0] ?? "";
  return prefixes.some((prefix) => pathname === prefix ||
    pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
}

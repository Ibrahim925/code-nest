import { isAbsolute, relative, resolve } from "node:path";

export const TRUSTED_TEST_SCHEMA_VERSION = "1.0" as const;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const IMAGE = /^[^\s@]+@sha256:[a-f0-9]{64}$/u;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const MEBIBYTE = 1_048_576;
const GIBIBYTE = 1_073_741_824;
const FORBIDDEN_ENVIRONMENT = new Set([
  "ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AZURE_OPENAI_API_KEY",
  "CODE_NEST_GATEWAY_TOKEN", "DOCKER_HOST", "GITHUB_TOKEN", "GOOGLE_API_KEY", "OPENAI_API_KEY",
  "SSH_AUTH_SOCK", "SUPABASE_SERVICE_ROLE_KEY",
]);

export type TrustedCiErrorCode =
  | "TRUSTED_CI_CLEANUP_FAILED"
  | "TRUSTED_CI_EXECUTION_FAILED"
  | "TRUSTED_CI_INVALID_INPUT"
  | "TRUSTED_CI_MATERIAL_MISMATCH"
  | "TRUSTED_CI_POLICY_MISMATCH"
  | "TRUSTED_CI_PROTOCOL_ERROR";

export class TrustedCiError extends Error {
  constructor(readonly code: TrustedCiErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TrustedCiError";
  }
}

export interface TrustedTestLimits {
  readonly cpuCount: number;
  readonly memoryBytes: number;
  readonly processCount: number;
  readonly workspaceBytes: number;
  readonly temporaryBytes: number;
  readonly maximumFileBytes: number;
  readonly wallTimeMilliseconds: number;
  readonly maximumOutputBytes: number;
  readonly stopGraceSeconds: number;
}

export interface TrustedTestRequest {
  readonly runId: string;
  readonly jobId: string;
  readonly candidatePath: string;
  readonly candidateRevision: string;
  readonly candidateDigest: string;
  readonly evaluatorPath: string;
  readonly evaluatorDigest: string;
  readonly evaluatorImage: string;
  readonly disclosure: "aggregate" | "public";
  readonly user: { readonly uid: number; readonly gid: number };
  readonly limits?: Partial<TrustedTestLimits>;
}

export interface NormalizedTrustedTestRequest extends Omit<TrustedTestRequest, "candidateDigest" | "evaluatorDigest" | "limits"> {
  readonly candidateDigest: `sha256:${string}`;
  readonly evaluatorDigest: `sha256:${string}`;
  readonly evaluatorImageDigest: `sha256:${string}`;
  readonly containerName: string;
  readonly limits: TrustedTestLimits;
}

export interface TrustedMaterialObservation {
  readonly candidateArchivePath: string;
  readonly candidateDigest: `sha256:${string}`;
  readonly evaluatorPath: string;
  readonly evaluatorDigest: `sha256:${string}`;
}

export interface TrustedContainerObservation {
  readonly containerId: string;
  readonly running: boolean;
  readonly user: string;
  readonly privileged: boolean;
  readonly rootFilesystemReadOnly: boolean;
  readonly networkMode: string;
  readonly ipcMode: string;
  readonly cgroupNamespaceMode: string;
  readonly pidMode: string;
  readonly userNamespaceMode: string;
  readonly capabilityDrops: readonly string[];
  readonly securityOptions: readonly string[];
  readonly deviceCount: number;
  readonly restartPolicy: string;
  readonly publishedPortCount: number;
  readonly resourceLimits: Readonly<Record<string, { readonly soft: number; readonly hard: number }>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly nanoCpus: number;
  readonly processCount: number;
  readonly bindMounts: readonly { readonly source: string; readonly destination: string; readonly readOnly: boolean }[];
  readonly attachedNetworks: readonly string[];
  readonly temporaryFilesystems: Readonly<Record<string, string>>;
  readonly environmentNames: readonly string[];
}

export interface TrustedEvaluatorCheck {
  readonly checkId: string;
  readonly visibility: "hidden" | "public";
  readonly passed: boolean;
  readonly summary: string;
}

export interface TrustedEvaluatorResult {
  readonly candidateDigest: `sha256:${string}`;
  readonly checks: readonly TrustedEvaluatorCheck[];
}

export interface TrustedPublicCheck {
  readonly checkId: string;
  readonly passed: boolean;
  readonly summary: string;
}

interface TrustedTestReportBase {
  readonly schemaVersion: typeof TRUSTED_TEST_SCHEMA_VERSION;
  readonly runId: string;
  readonly jobId: string;
  readonly candidateRevision: string;
  readonly candidateDigest: `sha256:${string}`;
  readonly evaluatorImageDigest: `sha256:${string}`;
  readonly evaluatorDigest: `sha256:${string}`;
  readonly outcome: "failed" | "passed";
  readonly passedChecks: number;
  readonly failedChecks: number;
}

export type UnsignedTrustedTestReport =
  | (TrustedTestReportBase & { readonly disclosure: "aggregate" })
  | (TrustedTestReportBase & { readonly disclosure: "public"; readonly checks: readonly TrustedPublicCheck[] });

export type TrustedTestReport = UnsignedTrustedTestReport & {
  readonly signature: `hmac-sha256:${string}`;
};

const DEFAULT_LIMITS: TrustedTestLimits = {
  cpuCount: 1,
  memoryBytes: 512 * MEBIBYTE,
  processCount: 128,
  workspaceBytes: GIBIBYTE,
  temporaryBytes: 64 * MEBIBYTE,
  maximumFileBytes: 256 * MEBIBYTE,
  wallTimeMilliseconds: 5 * 60_000,
  maximumOutputBytes: MEBIBYTE,
  stopGraceSeconds: 2,
};

function invalid(message: string): never {
  throw new TrustedCiError("TRUSTED_CI_INVALID_INPUT", message);
}

function integer(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function safePath(path: string, root: string, field: string): string {
  if (!isAbsolute(path) || !isAbsolute(root) || path.includes("\0") || path.includes(",")) {
    return invalid(`${field} path is invalid.`);
  }
  const normalized = resolve(path);
  const fromRoot = relative(resolve(root), normalized);
  if (fromRoot.length === 0 || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    return invalid(`${field} must remain below its trusted root.`);
  }
  return normalized;
}

export function normalizeTrustedTestRequest(
  request: TrustedTestRequest,
  roots: { readonly candidateRoot: string; readonly evaluatorRoot: string },
): NormalizedTrustedTestRequest {
  if (!IDENTIFIER.test(request.runId) || !IDENTIFIER.test(request.jobId)) invalid("Trusted test identifiers are invalid.");
  if (!REVISION.test(request.candidateRevision)) invalid("Candidate revision is invalid.");
  if (!DIGEST.test(request.candidateDigest) || !DIGEST.test(request.evaluatorDigest)) invalid("Trusted material digests are invalid.");
  if (!IMAGE.test(request.evaluatorImage)) invalid("Evaluator image must use an exact sha256 digest.");
  if (!integer(request.user.uid, 1, 2_147_483_647) || !integer(request.user.gid, 1, 2_147_483_647)) {
    invalid("Trusted test UID and GID must be explicit non-root integers.");
  }
  const limits = { ...DEFAULT_LIMITS, ...request.limits };
  if (
    !Number.isFinite(limits.cpuCount) || limits.cpuCount < 0.1 || limits.cpuCount > 8 ||
    !integer(limits.memoryBytes, 32 * MEBIBYTE, 16 * GIBIBYTE) ||
    !integer(limits.processCount, 16, 1_024) ||
    !integer(limits.workspaceBytes, MEBIBYTE, 10 * GIBIBYTE) ||
    !integer(limits.temporaryBytes, MEBIBYTE, GIBIBYTE) ||
    !integer(limits.maximumFileBytes, MEBIBYTE, limits.workspaceBytes) ||
    !integer(limits.wallTimeMilliseconds, 10, 3_600_000) ||
    !integer(limits.maximumOutputBytes, 1_024, 16 * MEBIBYTE) ||
    !integer(limits.stopGraceSeconds, 1, 30)
  ) invalid("Trusted test resource limits are outside the supported safe range.");
  return {
    ...request,
    candidatePath: safePath(request.candidatePath, roots.candidateRoot, "Candidate"),
    evaluatorPath: safePath(request.evaluatorPath, roots.evaluatorRoot, "Evaluator"),
    candidateDigest: request.candidateDigest as `sha256:${string}`,
    evaluatorDigest: request.evaluatorDigest as `sha256:${string}`,
    evaluatorImageDigest: request.evaluatorImage.slice(request.evaluatorImage.lastIndexOf("@") + 1) as `sha256:${string}`,
    containerName: `code-nest-trusted-${request.runId}-${request.jobId}`,
    limits,
  };
}

function hasTmpfs(observed: TrustedContainerObservation, target: string, bytes: number): boolean {
  return observed.temporaryFilesystems[target]?.split(",").includes(`size=${bytes}`) === true;
}

export function assertTrustedContainerPolicy(
  request: NormalizedTrustedTestRequest,
  material: TrustedMaterialObservation,
  observed: TrustedContainerObservation,
): void {
  const candidate = observed.bindMounts.find((mount) => mount.destination === "/opt/code-nest/input/candidate.tar");
  const evaluator = observed.bindMounts.find((mount) => mount.destination === "/opt/code-nest/evaluator/run.mjs");
  const valid = observed.running && observed.user === `${request.user.uid}:${request.user.gid}` &&
    !observed.privileged && observed.rootFilesystemReadOnly && observed.networkMode === "none" &&
    observed.ipcMode === "private" && observed.cgroupNamespaceMode === "private" &&
    observed.pidMode === "" && observed.userNamespaceMode !== "host" &&
    observed.capabilityDrops.length === 1 && observed.capabilityDrops[0]?.toUpperCase() === "ALL" &&
    observed.securityOptions.includes("no-new-privileges=true") &&
    observed.securityOptions.includes("seccomp=builtin") && observed.deviceCount === 0 &&
    observed.restartPolicy === "no" && observed.publishedPortCount === 0 &&
    observed.attachedNetworks.length === 1 && observed.attachedNetworks[0] === "none" &&
    observed.memoryBytes === request.limits.memoryBytes && observed.memorySwapBytes === request.limits.memoryBytes &&
    observed.nanoCpus === Math.round(request.limits.cpuCount * 1_000_000_000) &&
    observed.processCount === request.limits.processCount &&
    observed.resourceLimits.fsize?.soft === request.limits.maximumFileBytes &&
    observed.resourceLimits.fsize.hard === request.limits.maximumFileBytes &&
    observed.resourceLimits.nofile?.soft === 1_024 && observed.resourceLimits.nofile.hard === 1_024 &&
    observed.labels["code-nest.managed"] === "true" && observed.labels["code-nest.execution-mode"] === "trusted-test" &&
    observed.labels["code-nest.run-id"] === request.runId && observed.labels["code-nest.job-id"] === request.jobId &&
    observed.bindMounts.length === 2 && candidate?.source === material.candidateArchivePath && candidate.readOnly &&
    evaluator?.source === material.evaluatorPath && evaluator.readOnly &&
    Object.keys(observed.temporaryFilesystems).length === 2 &&
    hasTmpfs(observed, "/workspace", request.limits.workspaceBytes) &&
    hasTmpfs(observed, "/tmp", request.limits.temporaryBytes) &&
    observed.environmentNames.includes("CODE_NEST_CANDIDATE_DIGEST") &&
    observed.environmentNames.every((name) => !FORBIDDEN_ENVIRONMENT.has(name));
  if (!valid) throw new TrustedCiError("TRUSTED_CI_POLICY_MISMATCH", "Docker did not apply the complete trusted-test policy.");
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

export function parseTrustedEvaluatorResult(bytes: Uint8Array): TrustedEvaluatorResult {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; } catch (error: unknown) {
    throw new TrustedCiError("TRUSTED_CI_PROTOCOL_ERROR", "Trusted evaluator returned invalid JSON.", error);
  }
  if (!exactObject(value, ["schemaVersion", "candidateDigest", "checks"]) ||
      value.schemaVersion !== TRUSTED_TEST_SCHEMA_VERSION || !DIGEST.test(String(value.candidateDigest)) ||
      !Array.isArray(value.checks) || value.checks.length === 0 || value.checks.length > 1_000) {
    throw new TrustedCiError("TRUSTED_CI_PROTOCOL_ERROR", "Trusted evaluator result is invalid.");
  }
  const checks = value.checks.map((item): TrustedEvaluatorCheck => {
    if (!exactObject(item, ["checkId", "visibility", "passed", "summary"]) ||
        typeof item.checkId !== "string" || !IDENTIFIER.test(item.checkId) ||
        (item.visibility !== "hidden" && item.visibility !== "public") || typeof item.passed !== "boolean" ||
        typeof item.summary !== "string" || item.summary.length > 1_024 || /[\0\r\n]/u.test(item.summary)) {
      throw new TrustedCiError("TRUSTED_CI_PROTOCOL_ERROR", "Trusted evaluator check is invalid.");
    }
    return { checkId: item.checkId, visibility: item.visibility, passed: item.passed, summary: item.summary };
  });
  if (new Set(checks.map((check) => check.checkId)).size !== checks.length) {
    throw new TrustedCiError("TRUSTED_CI_PROTOCOL_ERROR", "Trusted evaluator check IDs must be unique.");
  }
  return { candidateDigest: value.candidateDigest as `sha256:${string}`, checks };
}

export function projectTrustedTestReport(
  request: NormalizedTrustedTestRequest,
  result: TrustedEvaluatorResult,
): UnsignedTrustedTestReport {
  if (result.candidateDigest !== request.candidateDigest) {
    throw new TrustedCiError("TRUSTED_CI_PROTOCOL_ERROR", "Trusted evaluator reported another candidate digest.");
  }
  const passedChecks = result.checks.filter((check) => check.passed).length;
  const common: TrustedTestReportBase = {
    schemaVersion: TRUSTED_TEST_SCHEMA_VERSION,
    runId: request.runId,
    jobId: request.jobId,
    candidateRevision: request.candidateRevision,
    candidateDigest: request.candidateDigest,
    evaluatorImageDigest: request.evaluatorImageDigest,
    evaluatorDigest: request.evaluatorDigest,
    outcome: passedChecks === result.checks.length ? "passed" : "failed",
    passedChecks,
    failedChecks: result.checks.length - passedChecks,
  };
  if (request.disclosure === "aggregate") return { ...common, disclosure: "aggregate" };
  return {
    ...common,
    disclosure: "public",
    checks: result.checks.filter((check) => check.visibility === "public").map(({ checkId, passed, summary }) => ({
      checkId, passed, summary,
    })),
  };
}

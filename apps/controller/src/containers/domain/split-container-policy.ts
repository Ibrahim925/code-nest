import { isAbsolute, relative, resolve } from "node:path";

export const SPLIT_CONTAINER_SCHEMA_VERSION = "1.0" as const;

const MEBIBYTE = 1_048_576;
const GIBIBYTE = 1_073_741_824;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const IMAGE = /^[^\s@]+@sha256:[a-f0-9]{64}$/;

export type SplitContainerErrorCode =
  | "CONTAINER_ALREADY_STARTED"
  | "CONTAINER_CLEANUP_FAILED"
  | "CONTAINER_COMMAND_LIMIT"
  | "CONTAINER_ENGINE_FAILURE"
  | "CONTAINER_NOT_RUNNING"
  | "CONTAINER_POLICY_MISMATCH"
  | "CONTAINER_START_FAILED"
  | "INVALID_CONTAINER_INPUT";

export class SplitContainerError extends Error {
  constructor(
    readonly code: SplitContainerErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SplitContainerError";
  }
}

export interface SplitContainerLimits {
  readonly cpuCount: number;
  readonly memoryBytes: number;
  readonly processCount: number;
  readonly workspaceBytes: number;
  readonly homeBytes: number;
  readonly temporaryBytes: number;
  readonly maximumFileBytes: number;
  readonly commandTimeoutMilliseconds: number;
  readonly maximumOutputBytes: number;
  readonly stopGraceSeconds: number;
}

export interface SplitContainerRequest {
  readonly runId: string;
  readonly participantId: string;
  readonly attemptId: string;
  readonly image: string;
  readonly workspacePath: string;
  readonly user: { readonly uid: number; readonly gid: number };
  readonly limits?: Partial<SplitContainerLimits>;
}

export interface NormalizedSplitContainerRequest extends SplitContainerRequest {
  readonly containerName: string;
  readonly imageDigest: `sha256:${string}`;
  readonly limits: SplitContainerLimits;
}

export interface SplitContainerCommand {
  readonly executable: string;
  readonly arguments?: readonly string[];
}

export interface NormalizedSplitContainerCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
}

export interface ObservedContainerPolicy {
  readonly containerId: string;
  readonly running: boolean;
  readonly paused: boolean;
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
  readonly resourceLimits: Readonly<Record<string, { readonly soft: number; readonly hard: number }>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly memoryBytes: number;
  readonly memorySwapBytes: number;
  readonly nanoCpus: number;
  readonly processCount: number;
  readonly bindMounts: readonly {
    readonly source: string;
    readonly destination: string;
    readonly readOnly: boolean;
  }[];
  readonly temporaryFilesystems: Readonly<Record<string, string>>;
  readonly environmentNames: readonly string[];
}

export interface SplitContainerManifest {
  readonly schemaVersion: typeof SPLIT_CONTAINER_SCHEMA_VERSION;
  readonly executionMode: "split";
  readonly runId: string;
  readonly participantId: string;
  readonly attemptId: string;
  readonly containerId: string;
  readonly imageDigest: `sha256:${string}`;
  readonly networkMode: "none";
  readonly user: { readonly uid: number; readonly gid: number };
  readonly rootFilesystemReadOnly: true;
  readonly privileged: false;
  readonly capabilityDrops: readonly ["ALL"];
  readonly noNewPrivileges: true;
  readonly seccompProfile: "builtin";
  readonly limits: SplitContainerLimits;
  readonly writableFilesystems: readonly {
    readonly target: "/workspace" | "/home/agent" | "/tmp";
    readonly maximumBytes: number;
  }[];
}

const DEFAULT_LIMITS: SplitContainerLimits = {
  cpuCount: 2,
  memoryBytes: 4 * GIBIBYTE,
  processCount: 256,
  workspaceBytes: 10 * GIBIBYTE,
  homeBytes: 512 * MEBIBYTE,
  temporaryBytes: 512 * MEBIBYTE,
  maximumFileBytes: 10 * GIBIBYTE,
  commandTimeoutMilliseconds: 15 * 60_000,
  maximumOutputBytes: 16 * MEBIBYTE,
  stopGraceSeconds: 2,
};

function invalid(message: string): never {
  throw new SplitContainerError("INVALID_CONTAINER_INPUT", message);
}

function integer(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function normalizeSplitContainerRequest(
  request: SplitContainerRequest,
  allowedWorkspaceRoot: string,
): NormalizedSplitContainerRequest {
  if (![request.runId, request.participantId, request.attemptId].every((id) => IDENTIFIER.test(id))) {
    return invalid("Container run, participant, and attempt IDs must be portable lowercase identifiers.");
  }
  if (!IMAGE.test(request.image)) return invalid("Container image must use an exact sha256 repository digest.");
  if (
    !isAbsolute(request.workspacePath) || request.workspacePath.includes("\0") ||
    request.workspacePath.includes(",") || !isAbsolute(allowedWorkspaceRoot)
  ) return invalid("Container workspace paths must be absolute and mount-safe.");
  const root = resolve(allowedWorkspaceRoot);
  const workspace = resolve(request.workspacePath);
  const fromRoot = relative(root, workspace);
  if (fromRoot.length === 0 || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    return invalid("Container workspace must be a participant directory below the configured root.");
  }
  if (!integer(request.user.uid, 1, 2_147_483_647) || !integer(request.user.gid, 1, 2_147_483_647)) {
    return invalid("Container UID and GID must be explicit non-root integers.");
  }
  const limits = { ...DEFAULT_LIMITS, ...request.limits };
  if (
    !Number.isFinite(limits.cpuCount) || limits.cpuCount < 0.1 || limits.cpuCount > 8 ||
    !integer(limits.memoryBytes, 32 * MEBIBYTE, 16 * GIBIBYTE) ||
    !integer(limits.processCount, 16, 1_024) ||
    !integer(limits.workspaceBytes, MEBIBYTE, 10 * GIBIBYTE) ||
    !integer(limits.homeBytes, MEBIBYTE, GIBIBYTE) ||
    !integer(limits.temporaryBytes, MEBIBYTE, GIBIBYTE) ||
    !integer(limits.maximumFileBytes, MEBIBYTE, limits.workspaceBytes) ||
    !integer(limits.commandTimeoutMilliseconds, 10, 3_600_000) ||
    !integer(limits.maximumOutputBytes, 1_024, 16 * MEBIBYTE) ||
    !integer(limits.stopGraceSeconds, 1, 30)
  ) return invalid("Container resource limits are outside the supported safe range.");
  return {
    ...request,
    workspacePath: workspace,
    containerName: `code-nest-${request.runId}-${request.participantId}-${request.attemptId}`,
    imageDigest: request.image.slice(request.image.lastIndexOf("@") + 1) as `sha256:${string}`,
    limits,
  };
}

export function normalizeSplitContainerCommand(
  command: SplitContainerCommand,
): NormalizedSplitContainerCommand {
  const arguments_ = command.arguments ?? [];
  if (
    command.executable.length === 0 || command.executable.length > 1_024 ||
    command.executable.includes("\0") || arguments_.length > 256 ||
    arguments_.some((value) => value.length > 16_384 || value.includes("\0"))
  ) return invalid("Container command is invalid or exceeds its argument boundary.");
  return { executable: command.executable, arguments: [...arguments_] };
}

const FORBIDDEN_ENVIRONMENT = new Set([
  "ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
  "AZURE_OPENAI_API_KEY", "DOCKER_HOST", "GITHUB_TOKEN", "GOOGLE_API_KEY",
  "OPENAI_API_KEY", "SSH_AUTH_SOCK", "SUPABASE_SERVICE_ROLE_KEY",
]);

function hasTmpfs(policy: ObservedContainerPolicy, target: string, bytes: number): boolean {
  const value = policy.temporaryFilesystems[target];
  return value !== undefined && value.split(",").includes(`size=${bytes}`);
}

export function assertObservedContainerPolicy(
  request: NormalizedSplitContainerRequest,
  policy: ObservedContainerPolicy,
): void {
  const seed = policy.bindMounts[0];
  const valid = policy.running && !policy.paused &&
    policy.user === `${request.user.uid}:${request.user.gid}` && !policy.privileged &&
    policy.rootFilesystemReadOnly && policy.networkMode === "none" &&
    policy.ipcMode === "private" && policy.cgroupNamespaceMode === "private" &&
    policy.pidMode === "" && policy.userNamespaceMode !== "host" &&
    policy.deviceCount === 0 && policy.restartPolicy === "no" &&
    policy.capabilityDrops.length === 1 && policy.capabilityDrops[0]?.toUpperCase() === "ALL" &&
    policy.securityOptions.includes("no-new-privileges=true") &&
    policy.securityOptions.includes("seccomp=builtin") &&
    policy.memoryBytes === request.limits.memoryBytes &&
    policy.memorySwapBytes === request.limits.memoryBytes &&
    policy.nanoCpus === Math.round(request.limits.cpuCount * 1_000_000_000) &&
    policy.processCount === request.limits.processCount &&
    policy.resourceLimits.fsize?.soft === request.limits.maximumFileBytes &&
    policy.resourceLimits.fsize?.hard === request.limits.maximumFileBytes &&
    policy.resourceLimits.nofile?.soft === 1_024 && policy.resourceLimits.nofile?.hard === 1_024 &&
    policy.labels["code-nest.managed"] === "true" &&
    policy.labels["code-nest.execution-mode"] === "split" &&
    policy.labels["code-nest.run-id"] === request.runId &&
    policy.labels["code-nest.participant-id"] === request.participantId &&
    policy.labels["code-nest.attempt-id"] === request.attemptId &&
    policy.bindMounts.length === 1 && seed?.source === request.workspacePath &&
    seed.destination === "/opt/code-nest/seed" && seed.readOnly &&
    Object.keys(policy.temporaryFilesystems).length === 3 &&
    hasTmpfs(policy, "/workspace", request.limits.workspaceBytes) &&
    hasTmpfs(policy, "/home/agent", request.limits.homeBytes) &&
    hasTmpfs(policy, "/tmp", request.limits.temporaryBytes) &&
    policy.environmentNames.every((name) => !FORBIDDEN_ENVIRONMENT.has(name));
  if (!valid) {
    throw new SplitContainerError(
      "CONTAINER_POLICY_MISMATCH",
      "Docker did not apply the complete split-runtime isolation policy.",
    );
  }
}

export function splitContainerManifest(
  request: NormalizedSplitContainerRequest,
  containerId: string,
): SplitContainerManifest {
  return {
    schemaVersion: SPLIT_CONTAINER_SCHEMA_VERSION,
    executionMode: "split",
    runId: request.runId,
    participantId: request.participantId,
    attemptId: request.attemptId,
    containerId,
    imageDigest: request.imageDigest,
    networkMode: "none",
    user: { ...request.user },
    rootFilesystemReadOnly: true,
    privileged: false,
    capabilityDrops: ["ALL"],
    noNewPrivileges: true,
    seccompProfile: "builtin",
    limits: { ...request.limits },
    writableFilesystems: [
      { target: "/workspace", maximumBytes: request.limits.workspaceBytes },
      { target: "/home/agent", maximumBytes: request.limits.homeBytes },
      { target: "/tmp", maximumBytes: request.limits.temporaryBytes },
    ],
  };
}

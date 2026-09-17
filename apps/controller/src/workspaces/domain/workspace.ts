import { isAbsolute, join, relative } from "node:path";

export const WORKSPACE_SCHEMA_VERSION = "1.0" as const;

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const GIT_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export type WorkspaceErrorCode =
  | "CAPTURE_TOO_LARGE"
  | "CANDIDATE_NOT_DESCENDANT"
  | "INVALID_WORKSPACE_INPUT"
  | "WORKSPACE_CAPTURE_FAILED"
  | "WORKSPACE_CLEANUP_FAILED"
  | "WORKSPACE_PROVISION_FAILED"
  | "WORKSPACE_RUN_EXISTS";

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WorkspaceError";
  }
}

export interface ParticipantWorkspace {
  readonly schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  readonly runId: string;
  readonly participantId: string;
  readonly path: string;
  readonly baseRevision: string;
}

export interface WorkspaceCommit {
  readonly revision: string;
  readonly parentRevisions: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAt: string;
  readonly message: string;
}

export interface UntrackedWorkspaceFile {
  readonly path: string;
  readonly kind: "file" | "symbolic_link";
  readonly digest: `sha256:${string}`;
  readonly bytes: Uint8Array;
}

export interface WorkspaceCapture {
  readonly schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  readonly runId: string;
  readonly participantId: string;
  readonly baseRevision: string;
  readonly candidateRevision: string;
  readonly commits: readonly WorkspaceCommit[];
  readonly trackedPatch: Uint8Array;
  readonly untrackedFiles: readonly UntrackedWorkspaceFile[];
}

function invalid(message: string): never {
  throw new WorkspaceError("INVALID_WORKSPACE_INPUT", message);
}

export function workspaceIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return invalid(
      `Workspace ${field} must be a lowercase portable identifier of at most 128 characters.`,
    );
  }
  return value;
}

export function gitRevision(value: unknown): string {
  if (typeof value !== "string" || !GIT_REVISION_PATTERN.test(value)) {
    return invalid(
      "Workspace base revision must be a full lowercase Git object ID.",
    );
  }
  return value;
}

export function absolutePath(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    !isAbsolute(value)
  ) {
    return invalid(`Workspace ${field} must be an absolute filesystem path.`);
  }
  return value;
}

export function participantWorkspace(
  rootPath: string,
  runId: string,
  participantId: string,
  baseRevision: string,
): ParticipantWorkspace {
  const root = absolutePath(rootPath, "root path");
  const run = workspaceIdentifier(runId, "run ID");
  const participant = workspaceIdentifier(participantId, "participant ID");
  const revision = gitRevision(baseRevision);
  const path = join(root, run, participant);
  const pathFromRoot = relative(root, path);

  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    return invalid("Participant workspace must remain inside the workspace root.");
  }

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    runId: run,
    participantId: participant,
    path,
    baseRevision: revision,
  };
}

export function runWorkspacePath(rootPath: string, runId: string): string {
  const root = absolutePath(rootPath, "root path");
  return join(root, workspaceIdentifier(runId, "run ID"));
}

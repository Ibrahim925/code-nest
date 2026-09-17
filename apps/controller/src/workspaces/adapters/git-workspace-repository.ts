import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type {
  CreateWorkspaceRequest,
  WorkspaceRepository,
} from "../application/ports/workspace-repository.js";
import {
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceError,
  type ParticipantWorkspace,
  type UntrackedWorkspaceFile,
  type WorkspaceCapture,
  type WorkspaceCommit,
} from "../domain/workspace.js";

const DEFAULT_MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const GIT_COMMAND_OVERHEAD_BYTES = 1024 * 1024;

interface GitCommandResult {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number;
}

class GitCommandError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly stderr: Buffer,
    cause?: unknown,
  ) {
    super("Git command failed.", cause === undefined ? undefined : { cause });
    this.name = "GitCommandError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function runGit(
  arguments_: readonly string[],
  options: {
    readonly cwd?: string;
    readonly maximumBytes?: number;
    readonly allowedExitCodes?: readonly number[];
  } = {},
): Promise<GitCommandResult> {
  const maximumBytes =
    options.maximumBytes ?? DEFAULT_MAX_CAPTURE_BYTES + GIT_COMMAND_OVERHEAD_BYTES;
  const allowedExitCodes = options.allowedExitCodes ?? [0];

  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      [...arguments_],
      {
        cwd: options.cwd,
        encoding: null,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
        maxBuffer: maximumBytes,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const stdoutBuffer = Buffer.isBuffer(stdout)
          ? stdout
          : Buffer.from(stdout);
        const stderrBuffer = Buffer.isBuffer(stderr)
          ? stderr
          : Buffer.from(stderr);
        const exitCode =
          error === null
            ? 0
            : typeof error.code === "number"
              ? error.code
              : null;

        if (exitCode !== null && allowedExitCodes.includes(exitCode)) {
          resolvePromise({ exitCode, stderr: stderrBuffer, stdout: stdoutBuffer });
          return;
        }

        rejectPromise(new GitCommandError(exitCode, stderrBuffer, error));
      },
    );
  });
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function lineList(bytes: Uint8Array): string[] {
  const value = text(bytes).trim();
  return value.length === 0 ? [] : value.split("\n");
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safeRelativePath(root: string, bytes: Buffer): string {
  const path = bytes.toString("utf8");
  if (!Buffer.from(path, "utf8").equals(bytes) || path.length === 0) {
    throw new WorkspaceError(
      "WORKSPACE_CAPTURE_FAILED",
      "Workspace contains a filename that is not valid UTF-8.",
    );
  }

  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (
    fromRoot.length === 0 ||
    fromRoot.startsWith("..") ||
    isAbsolute(fromRoot)
  ) {
    throw new WorkspaceError(
      "WORKSPACE_CAPTURE_FAILED",
      "Workspace change resolved outside its participant directory.",
    );
  }
  return path;
}

async function readCommit(
  workspacePath: string,
  revision: string,
): Promise<WorkspaceCommit> {
  const result = await runGit(
    [
      "show",
      "--no-patch",
      "--no-show-signature",
      "--format=format:%H%x00%P%x00%an%x00%ae%x00%aI%x00%B",
      revision,
      "--",
    ],
    { cwd: workspacePath },
  );
  const fields = text(result.stdout).split("\0");
  if (fields.length !== 6) {
    throw new WorkspaceError(
      "WORKSPACE_CAPTURE_FAILED",
      "Git returned malformed commit authorship data.",
    );
  }

  const [commitRevision, parents, authorName, authorEmail, authoredAt, message] =
    fields;
  if (
    commitRevision === undefined ||
    parents === undefined ||
    authorName === undefined ||
    authorEmail === undefined ||
    authoredAt === undefined ||
    message === undefined
  ) {
    throw new WorkspaceError(
      "WORKSPACE_CAPTURE_FAILED",
      "Git returned incomplete commit authorship data.",
    );
  }

  return {
    revision: commitRevision,
    parentRevisions: parents.length === 0 ? [] : parents.split(" "),
    authorName,
    authorEmail,
    authoredAt,
    message,
  };
}

async function untrackedFiles(
  workspacePath: string,
  maximumBytes: number,
  alreadyCapturedBytes: number,
): Promise<readonly UntrackedWorkspaceFile[]> {
  const result = await runGit(
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
    { cwd: workspacePath },
  );
  const encodedPaths = result.stdout.subarray(0, -1).length === 0
    ? []
    : result.stdout.subarray(0, -1).toString("binary").split("\0").map(
        (path) => Buffer.from(path, "binary"),
      );
  const captures: UntrackedWorkspaceFile[] = [];
  let capturedBytes = alreadyCapturedBytes;

  for (const encodedPath of encodedPaths) {
    const path = safeRelativePath(workspacePath, encodedPath);
    const absolute = resolve(workspacePath, path);
    const metadata = await lstat(absolute);
    let kind: UntrackedWorkspaceFile["kind"];
    let bytes: Buffer;

    if (metadata.isSymbolicLink()) {
      kind = "symbolic_link";
      bytes = Buffer.from(await readlink(absolute), "utf8");
    } else if (metadata.isFile()) {
      kind = "file";
      if (metadata.size > maximumBytes - capturedBytes) {
        throw new WorkspaceError(
          "CAPTURE_TOO_LARGE",
          `Workspace capture exceeds ${maximumBytes} bytes.`,
        );
      }
      bytes = await readFile(absolute);
    } else {
      throw new WorkspaceError(
        "WORKSPACE_CAPTURE_FAILED",
        "Workspace contains an unsupported untracked filesystem entry.",
      );
    }

    capturedBytes += bytes.byteLength;
    if (capturedBytes > maximumBytes) {
      throw new WorkspaceError(
        "CAPTURE_TOO_LARGE",
        `Workspace capture exceeds ${maximumBytes} bytes.`,
      );
    }

    captures.push({
      path,
      kind,
      digest: digest(bytes),
      bytes: Buffer.from(bytes),
    });
  }

  return captures;
}

async function assertPrivateGitDirectory(workspacePath: string): Promise<void> {
  const metadata = await lstat(resolve(workspacePath, ".git"));
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new WorkspaceError(
      "WORKSPACE_CAPTURE_FAILED",
      "Participant Git metadata must be a private directory inside its workspace.",
    );
  }
}

export class GitWorkspaceRepository implements WorkspaceRepository {
  readonly #maximumCaptureBytes: number;

  constructor(maximumCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES) {
    if (!Number.isSafeInteger(maximumCaptureBytes) || maximumCaptureBytes < 1) {
      throw new WorkspaceError(
        "INVALID_WORKSPACE_INPUT",
        "Workspace capture limit must be a positive integer number of bytes.",
      );
    }
    this.#maximumCaptureBytes = maximumCaptureBytes;
  }

  async prepareRun(runPath: string): Promise<void> {
    try {
      await mkdir(dirname(runPath), { mode: 0o700, recursive: true });
      await mkdir(runPath, { mode: 0o700 });
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "EEXIST")) {
        throw new WorkspaceError(
          "WORKSPACE_RUN_EXISTS",
          "A workspace directory already exists for this run.",
          error,
        );
      }
      throw error;
    }
  }

  async createWorkspace(request: CreateWorkspaceRequest): Promise<void> {
    const { repositoryPath, workspace } = request;
    await runGit([
      "clone",
      "--no-hardlinks",
      "--no-checkout",
      "--no-tags",
      "--quiet",
      "--",
      repositoryPath,
      workspace.path,
    ]);
    await chmod(workspace.path, 0o700);
    await runGit(
      ["checkout", "--detach", workspace.baseRevision, "--"],
      { cwd: workspace.path },
    );

    const actualRevision = text(
      (await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: workspace.path,
      })).stdout,
    ).trim();
    if (actualRevision !== workspace.baseRevision) {
      throw new WorkspaceError(
        "WORKSPACE_PROVISION_FAILED",
        "Participant workspace did not resolve to the verified base revision.",
      );
    }

    await runGit(["remote", "remove", "origin"], { cwd: workspace.path });
    await runGit(
      [
        "config",
        "--local",
        "user.name",
        `Code Nest ${workspace.participantId}`,
      ],
      { cwd: workspace.path },
    );
    await runGit(
      [
        "config",
        "--local",
        "user.email",
        `${workspace.participantId}@code-nest.invalid`,
      ],
      { cwd: workspace.path },
    );
  }

  async captureWorkspace(
    workspace: ParticipantWorkspace,
  ): Promise<WorkspaceCapture> {
    try {
      await assertPrivateGitDirectory(workspace.path);
      const candidateRevision = text(
        (await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
          cwd: workspace.path,
        })).stdout,
      ).trim();
      const ancestry = await runGit(
        [
          "merge-base",
          "--is-ancestor",
          workspace.baseRevision,
          candidateRevision,
        ],
        { allowedExitCodes: [0, 1], cwd: workspace.path },
      );
      if (ancestry.exitCode === 1) {
        throw new WorkspaceError(
          "CANDIDATE_NOT_DESCENDANT",
          "Participant candidate is not descended from the verified base revision.",
        );
      }

      const commitRevisions = lineList(
        (
          await runGit(
            [
              "rev-list",
              "--reverse",
              `${workspace.baseRevision}..${candidateRevision}`,
              "--",
            ],
            { cwd: workspace.path },
          )
        ).stdout,
      );
      const commits: WorkspaceCommit[] = [];
      for (const revision of commitRevisions) {
        commits.push(await readCommit(workspace.path, revision));
      }

      const trackedPatch = (
        await runGit(
          [
            "diff",
            "--binary",
            "--full-index",
            "--no-ext-diff",
            workspace.baseRevision,
            "--",
          ],
          {
            cwd: workspace.path,
            maximumBytes:
              this.#maximumCaptureBytes + GIT_COMMAND_OVERHEAD_BYTES,
          },
        )
      ).stdout;
      if (trackedPatch.byteLength > this.#maximumCaptureBytes) {
        throw new WorkspaceError(
          "CAPTURE_TOO_LARGE",
          `Workspace capture exceeds ${this.#maximumCaptureBytes} bytes.`,
        );
      }
      const untracked = await untrackedFiles(
        workspace.path,
        this.#maximumCaptureBytes,
        trackedPatch.byteLength,
      );

      return {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        runId: workspace.runId,
        participantId: workspace.participantId,
        baseRevision: workspace.baseRevision,
        candidateRevision,
        commits,
        trackedPatch: Buffer.from(trackedPatch),
        untrackedFiles: untracked,
      };
    } catch (error: unknown) {
      if (error instanceof WorkspaceError) throw error;
      if (
        error instanceof GitCommandError &&
        isNodeErrorWithCode(error.cause, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      ) {
        throw new WorkspaceError(
          "CAPTURE_TOO_LARGE",
          `Workspace capture exceeds ${this.#maximumCaptureBytes} bytes.`,
          error,
        );
      }
      throw new WorkspaceError(
        "WORKSPACE_CAPTURE_FAILED",
        "Participant workspace capture failed.",
        error,
      );
    }
  }

  async removeRun(runPath: string): Promise<void> {
    await rm(runPath, { force: true, recursive: true });
  }
}

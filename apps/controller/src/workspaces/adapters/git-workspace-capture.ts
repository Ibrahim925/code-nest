import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceError,
  type ParticipantWorkspace,
  type UntrackedWorkspaceFile,
  type WorkspaceCapture,
  type WorkspaceCommit,
} from "../domain/workspace.js";
import {
  GIT_COMMAND_OVERHEAD_BYTES,
  gitLineList,
  gitText,
  runGit,
} from "../../git/git-command.js";

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
  const fromRoot = relative(root, resolve(root, path));
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
  const fields = gitText(result.stdout).split("\0");
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

function encodedUntrackedPaths(stdout: Buffer): Buffer[] {
  if (stdout.length === 0) return [];
  return stdout
    .subarray(0, -1)
    .toString("binary")
    .split("\0")
    .map((path) => Buffer.from(path, "binary"));
}

async function captureUntrackedFiles(
  workspacePath: string,
  maximumBytes: number,
  alreadyCapturedBytes: number,
): Promise<readonly UntrackedWorkspaceFile[]> {
  const result = await runGit(
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
    { cwd: workspacePath },
  );
  const captures: UntrackedWorkspaceFile[] = [];
  let capturedBytes = alreadyCapturedBytes;

  for (const encodedPath of encodedUntrackedPaths(result.stdout)) {
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

export async function captureGitWorkspace(
  workspace: ParticipantWorkspace,
  maximumCaptureBytes: number,
): Promise<WorkspaceCapture> {
  await assertPrivateGitDirectory(workspace.path);
  const candidateRevision = gitText(
    (await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: workspace.path,
    })).stdout,
  ).trim();
  const ancestry = await runGit(
    ["merge-base", "--is-ancestor", workspace.baseRevision, candidateRevision],
    { allowedExitCodes: [0, 1], cwd: workspace.path },
  );
  if (ancestry.exitCode === 1) {
    throw new WorkspaceError(
      "CANDIDATE_NOT_DESCENDANT",
      "Participant candidate is not descended from the verified base revision.",
    );
  }

  const revisions = gitLineList(
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
  for (const revision of revisions) {
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
        maximumBytes: maximumCaptureBytes + GIT_COMMAND_OVERHEAD_BYTES,
      },
    )
  ).stdout;
  if (trackedPatch.byteLength > maximumCaptureBytes) {
    throw new WorkspaceError(
      "CAPTURE_TOO_LARGE",
      `Workspace capture exceeds ${maximumCaptureBytes} bytes.`,
    );
  }
  const untrackedFiles = await captureUntrackedFiles(
    workspace.path,
    maximumCaptureBytes,
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
    untrackedFiles,
  };
}

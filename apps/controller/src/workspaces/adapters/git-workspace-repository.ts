import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  CreateWorkspaceRequest,
  WorkspaceRepository,
} from "../application/ports/workspace-repository.js";
import {
  WorkspaceError,
  type ParticipantWorkspace,
  type WorkspaceCapture,
} from "../domain/workspace.js";
import {
  DEFAULT_MAX_CAPTURE_BYTES,
  GitCommandError,
  gitText,
  isNodeErrorWithCode,
  runGit,
} from "./git-command.js";
import { captureGitWorkspace } from "./git-workspace-capture.js";

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
    await runGit(["checkout", "--detach", workspace.baseRevision, "--"], {
      cwd: workspace.path,
    });
    const actualRevision = gitText(
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
      ["config", "--local", "user.name", `Code Nest ${workspace.participantId}`],
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
      return await captureGitWorkspace(workspace, this.#maximumCaptureBytes);
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

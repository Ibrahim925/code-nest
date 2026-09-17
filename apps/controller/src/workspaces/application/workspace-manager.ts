import {
  absolutePath,
  gitRevision,
  participantWorkspace,
  runWorkspacePath,
  WorkspaceError,
  workspaceIdentifier,
  type ParticipantWorkspace,
  type WorkspaceCapture,
} from "../domain/workspace.js";
import type { WorkspaceRepository } from "./ports/workspace-repository.js";

const PARTICIPANT_COUNT = 4;

export interface ProvisionWorkspacesRequest {
  readonly runId: string;
  readonly participantIds: readonly string[];
  readonly repositoryPath: string;
  readonly baseRevision: string;
}

export class WorkspaceManager {
  readonly #rootPath: string;
  readonly #repository: WorkspaceRepository;

  constructor(rootPath: string, repository: WorkspaceRepository) {
    this.#rootPath = absolutePath(rootPath, "root path");
    this.#repository = repository;
  }

  async provision(
    request: ProvisionWorkspacesRequest,
  ): Promise<readonly ParticipantWorkspace[]> {
    const runId = workspaceIdentifier(request.runId, "run ID");
    const repositoryPath = absolutePath(
      request.repositoryPath,
      "repository path",
    );
    const baseRevision = gitRevision(request.baseRevision);
    const participantIds = request.participantIds.map((participantId) =>
      workspaceIdentifier(participantId, "participant ID"),
    );

    if (participantIds.length !== PARTICIPANT_COUNT) {
      throw new WorkspaceError(
        "INVALID_WORKSPACE_INPUT",
        `A run must provision exactly ${PARTICIPANT_COUNT} participant workspaces.`,
      );
    }
    if (new Set(participantIds).size !== participantIds.length) {
      throw new WorkspaceError(
        "INVALID_WORKSPACE_INPUT",
        "Participant workspace IDs must be unique within a run.",
      );
    }

    const runPath = runWorkspacePath(this.#rootPath, runId);
    const workspaces = participantIds.map((participantId) =>
      participantWorkspace(
        this.#rootPath,
        runId,
        participantId,
        baseRevision,
      ),
    );

    let prepared = false;
    try {
      await this.#repository.prepareRun(runPath);
      prepared = true;
      for (const workspace of workspaces) {
        await this.#repository.createWorkspace({ repositoryPath, workspace });
      }
      return workspaces;
    } catch (error: unknown) {
      if (!prepared) {
        if (error instanceof WorkspaceError) throw error;
        throw new WorkspaceError(
          "WORKSPACE_PROVISION_FAILED",
          "Participant workspace setup failed before the run directory was created.",
          error,
        );
      }

      try {
        await this.#repository.removeRun(runPath);
      } catch (cleanupError: unknown) {
        throw new WorkspaceError(
          "WORKSPACE_CLEANUP_FAILED",
          "Participant workspace setup failed and its partial run could not be removed.",
          new AggregateError([error, cleanupError]),
        );
      }

      throw new WorkspaceError(
        "WORKSPACE_PROVISION_FAILED",
        "Participant workspace setup failed; the partial run was removed.",
        error,
      );
    }
  }

  async capture(workspace: ParticipantWorkspace): Promise<WorkspaceCapture> {
    const expected = participantWorkspace(
      this.#rootPath,
      workspace.runId,
      workspace.participantId,
      workspace.baseRevision,
    );
    if (
      workspace.schemaVersion !== expected.schemaVersion ||
      workspace.path !== expected.path
    ) {
      throw new WorkspaceError(
        "INVALID_WORKSPACE_INPUT",
        "Workspace capture must reference a manager-owned participant path.",
      );
    }

    return this.#repository.captureWorkspace(expected);
  }

  async cleanup(runId: string): Promise<void> {
    const runPath = runWorkspacePath(this.#rootPath, runId);
    try {
      await this.#repository.removeRun(runPath);
    } catch (error: unknown) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError(
        "WORKSPACE_CLEANUP_FAILED",
        "Participant workspace cleanup failed.",
        error,
      );
    }
  }
}

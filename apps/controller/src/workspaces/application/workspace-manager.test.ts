import { describe, expect, it } from "vitest";

import type {
  CreateWorkspaceRequest,
  WorkspaceRepository,
} from "./ports/workspace-repository.js";
import { WorkspaceManager } from "./workspace-manager.js";
import type { WorkspaceCapture } from "../domain/workspace.js";

const BASE_REVISION = "1".repeat(40);

class FailingWorkspaceRepository implements WorkspaceRepository {
  readonly calls: string[] = [];

  async prepareRun(runPath: string): Promise<void> {
    this.calls.push(`prepare:${runPath}`);
  }

  async createWorkspace(request: CreateWorkspaceRequest): Promise<void> {
    this.calls.push(`create:${request.workspace.participantId}`);
    if (request.workspace.participantId === "player-c") {
      throw new Error("synthetic third-workspace failure");
    }
  }

  captureWorkspace(): Promise<WorkspaceCapture> {
    throw new Error("not used by this test");
  }

  async removeRun(runPath: string): Promise<void> {
    this.calls.push(`remove:${runPath}`);
  }
}

describe("workspace manager", () => {
  it("removes the whole partial run when any participant setup fails", async () => {
    const repository = new FailingWorkspaceRepository();
    const manager = new WorkspaceManager("/tmp/code-nest-workspaces", repository);

    await expect(
      manager.provision({
        runId: "run-001",
        participantIds: ["player-a", "player-b", "player-c", "player-d"],
        repositoryPath: "/tmp/source-repository",
        baseRevision: BASE_REVISION,
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_PROVISION_FAILED" });

    expect(repository.calls).toEqual([
      "prepare:/tmp/code-nest-workspaces/run-001",
      "create:player-a",
      "create:player-b",
      "create:player-c",
      "remove:/tmp/code-nest-workspaces/run-001",
    ]);
  });
});

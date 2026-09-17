import type {
  ParticipantWorkspace,
  WorkspaceCapture,
} from "../../domain/workspace.js";

export interface CreateWorkspaceRequest {
  readonly repositoryPath: string;
  readonly workspace: ParticipantWorkspace;
}

export interface WorkspaceRepository {
  prepareRun(runPath: string): Promise<void>;
  createWorkspace(request: CreateWorkspaceRequest): Promise<void>;
  captureWorkspace(workspace: ParticipantWorkspace): Promise<WorkspaceCapture>;
  removeRun(runPath: string): Promise<void>;
}

import { gitText, runGit } from "../../git/git-command.js";
import type { ParticipantWorkspace } from "../../workspaces/domain/workspace.js";
import type {
  ContainedOmpBoundary,
  ContainedWorkspaceSynchronizer,
} from "../application/ports/contained-omp-ports.js";

/** Keeps a discussion turn's filesystem changes outside the proposal path. */
export class DiscardingWorkspaceSynchronizer
  implements ContainedWorkspaceSynchronizer
{
  async synchronize(
    _boundary: ContainedOmpBoundary,
    workspace: ParticipantWorkspace,
  ) {
    const [revision, summary] = await Promise.all([
      runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: workspace.path,
      }),
      runGit(["log", "-1", "--format=%s", "HEAD", "--"], {
        cwd: workspace.path,
      }),
    ]);
    return {
      candidateRevision: gitText(revision.stdout).trim(),
      commitSummary: gitText(summary.stdout).trim() || "Town Hall discussion",
    };
  }
}

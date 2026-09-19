import type { MatchRuntimeFactory } from "../../matches/application/ports/one-round-match-ports.js";
import type { ParticipantWorkspace } from "../../workspaces/domain/workspace.js";
import {
  normalizeOmpLiveConfiguration,
  type OmpLiveConfiguration,
} from "../domain/omp-live-configuration.js";
import { ContainedOmpParticipant } from "./contained-omp-participant.js";
import type {
  ContainedOmpDependencies,
  ContainedWorkspaceSynchronizer,
} from "./ports/contained-omp-ports.js";

export class ContainedOmpRuntimeFactory implements MatchRuntimeFactory {
  readonly #configuration;

  constructor(
    configuration: OmpLiveConfiguration,
    private readonly dependencies: ContainedOmpDependencies,
    private readonly synchronizer: ContainedWorkspaceSynchronizer,
  ) {
    this.#configuration = normalizeOmpLiveConfiguration(configuration);
  }

  async create(workspace: ParticipantWorkspace): Promise<ContainedOmpParticipant> {
    return new ContainedOmpParticipant(
      workspace,
      this.#configuration,
      this.dependencies,
      this.synchronizer,
    );
  }
}

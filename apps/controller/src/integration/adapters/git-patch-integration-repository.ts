import { isAbsolute, resolve } from "node:path";

import { DEFAULT_MAX_GIT_BYTES } from "../../git/git-command.js";
import type {
  NormalizedPatch,
  PatchIntegrationRepository,
  PatchNormalizationResult,
  PrepareReleaseCandidateRequest,
  ReleaseCandidate,
} from "../application/ports/patch-integration-repository.js";
import {
  IntegrationError,
  type AuthorizedPatchProposal,
  type PatchIntegrationOutcome,
} from "../domain/integration.js";
import {
  applyNormalizedPatch,
  prepareReleaseCandidate,
  readCandidateRevision,
} from "./git-release-candidate.js";
import { normalizeGitPatch } from "./git-patch-normalization.js";

export class GitPatchIntegrationRepository
  implements PatchIntegrationRepository
{
  readonly #releaseRoot: string;
  readonly #workspaceRoot: string;
  readonly #maximumPatchBytes: number;

  constructor(
    releaseRoot: string,
    workspaceRoot: string,
    maximumPatchBytes = DEFAULT_MAX_GIT_BYTES,
  ) {
    if (
      !isAbsolute(releaseRoot) ||
      !isAbsolute(workspaceRoot) ||
      !Number.isSafeInteger(maximumPatchBytes) ||
      maximumPatchBytes < 1
    ) {
      throw new IntegrationError(
        "INVALID_INTEGRATION_INPUT",
        "Integration roots must be absolute and the patch limit must be positive.",
      );
    }
    this.#releaseRoot = resolve(releaseRoot);
    this.#workspaceRoot = resolve(workspaceRoot);
    this.#maximumPatchBytes = maximumPatchBytes;
  }

  prepare(request: PrepareReleaseCandidateRequest): Promise<ReleaseCandidate> {
    return prepareReleaseCandidate(this.#releaseRoot, request);
  }

  normalize(
    runId: string,
    proposal: AuthorizedPatchProposal,
  ): Promise<PatchNormalizationResult> {
    return normalizeGitPatch(
      this.#workspaceRoot,
      this.#maximumPatchBytes,
      runId,
      proposal,
    );
  }

  apply(
    candidate: ReleaseCandidate,
    patch: NormalizedPatch,
  ): Promise<PatchIntegrationOutcome> {
    return applyNormalizedPatch(candidate, patch);
  }

  currentRevision(candidate: ReleaseCandidate): Promise<string> {
    return readCandidateRevision(candidate);
  }
}

import type {
  AuthorizedPatchProposal,
  PatchIntegrationOutcome,
} from "../../domain/integration.js";

export interface ReleaseCandidate {
  readonly path: string;
  readonly baseRevision: string;
}

export interface NormalizedPatch {
  readonly proposalId: string;
  readonly participantId: string;
  readonly digest: `sha256:${string}`;
  readonly bytes: Uint8Array;
}

export type PatchNormalizationResult =
  | { readonly status: "normalized"; readonly patch: NormalizedPatch }
  | { readonly status: "rejected_ancestry"; readonly reason: string };

export interface PrepareReleaseCandidateRequest {
  readonly runId: string;
  readonly baseRepositoryPath: string;
  readonly baseRevision: string;
}

export interface PatchIntegrationRepository {
  prepare(
    request: PrepareReleaseCandidateRequest,
  ): Promise<ReleaseCandidate>;
  normalize(
    runId: string,
    proposal: AuthorizedPatchProposal,
  ): Promise<PatchNormalizationResult>;
  apply(
    candidate: ReleaseCandidate,
    patch: NormalizedPatch,
  ): Promise<PatchIntegrationOutcome>;
  currentRevision(candidate: ReleaseCandidate): Promise<string>;
}

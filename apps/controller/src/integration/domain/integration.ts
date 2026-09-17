import { isAbsolute } from "node:path";

export const INTEGRATION_SCHEMA_VERSION = "1.0" as const;

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const GIT_REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export type IntegrationErrorCode =
  | "INVALID_INTEGRATION_INPUT"
  | "PATCH_APPLICATION_FAILED"
  | "PATCH_NORMALIZATION_FAILED"
  | "RELEASE_CANDIDATE_EXISTS"
  | "RELEASE_PREPARATION_FAILED";

export class IntegrationError extends Error {
  constructor(
    readonly code: IntegrationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "IntegrationError";
  }
}

export interface AuthorizedPatchProposal {
  readonly proposalId: string;
  readonly participantId: string;
  readonly sourceRepositoryPath: string;
  readonly baseRevision: string;
  readonly candidateRevision: string;
}

export interface PatchIntegrationRequest {
  readonly runId: string;
  readonly baseRepositoryPath: string;
  readonly baseRevision: string;
  readonly proposals: readonly AuthorizedPatchProposal[];
  readonly proposalOrder: readonly string[];
}

export type PatchOutcomeStatus =
  | "conflict"
  | "integrated"
  | "no_changes"
  | "rejected_ancestry";

export interface PatchIntegrationOutcome {
  readonly proposalId: string;
  readonly participantId: string;
  readonly status: PatchOutcomeStatus;
  readonly normalizedPatchDigest: `sha256:${string}` | null;
  readonly integratedRevision: string | null;
  readonly reason: string | null;
}

export interface PatchIntegrationReport {
  readonly schemaVersion: typeof INTEGRATION_SCHEMA_VERSION;
  readonly runId: string;
  readonly baseRevision: string;
  readonly candidateRevision: string;
  readonly candidatePath: string;
  readonly outcomes: readonly PatchIntegrationOutcome[];
}

function invalid(message: string): never {
  throw new IntegrationError("INVALID_INTEGRATION_INPUT", message);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return invalid(`Integration ${field} must be a lowercase portable identifier.`);
  }
  return value;
}

function revision(value: unknown): string {
  if (typeof value !== "string" || !GIT_REVISION_PATTERN.test(value)) {
    return invalid("Integration revisions must be full lowercase Git object IDs.");
  }
  return value;
}

function absolutePath(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    !isAbsolute(value)
  ) {
    return invalid(`Integration ${field} must be an absolute filesystem path.`);
  }
  return value;
}

export function validateIntegrationRequest(
  request: PatchIntegrationRequest,
): readonly AuthorizedPatchProposal[] {
  identifier(request.runId, "run ID");
  absolutePath(request.baseRepositoryPath, "base repository path");
  const baseRevision = revision(request.baseRevision);
  if (!Array.isArray(request.proposals) || !Array.isArray(request.proposalOrder)) {
    return invalid("Integration proposals and declared order must be arrays.");
  }

  const proposals = new Map<string, AuthorizedPatchProposal>();
  for (const proposal of request.proposals) {
    const proposalId = identifier(proposal.proposalId, "proposal ID");
    identifier(proposal.participantId, "participant ID");
    absolutePath(proposal.sourceRepositoryPath, "source repository path");
    if (
      revision(proposal.baseRevision) !== baseRevision ||
      revision(proposal.candidateRevision).length !== baseRevision.length ||
      proposals.has(proposalId)
    ) {
      return invalid("Integration proposals require one shared base and unique IDs.");
    }
    proposals.set(proposalId, { ...proposal });
  }

  if (
    request.proposalOrder.length !== proposals.size ||
    new Set(request.proposalOrder).size !== proposals.size ||
    request.proposalOrder.some((proposalId) => !proposals.has(proposalId))
  ) {
    return invalid("Declared order must contain every proposal ID exactly once.");
  }
  return request.proposalOrder.map((proposalId) => {
    const proposal = proposals.get(proposalId);
    if (proposal === undefined) return invalid("Declared proposal is unavailable.");
    return proposal;
  });
}

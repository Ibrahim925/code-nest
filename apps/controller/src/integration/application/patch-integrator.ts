import type { PatchIntegrationRepository } from "./ports/patch-integration-repository.js";
import {
  INTEGRATION_SCHEMA_VERSION,
  validateIntegrationRequest,
  type PatchIntegrationOutcome,
  type PatchIntegrationReport,
  type PatchIntegrationRequest,
} from "../domain/integration.js";

export class PatchIntegrator {
  constructor(private readonly repository: PatchIntegrationRepository) {}

  async integrate(
    request: PatchIntegrationRequest,
  ): Promise<PatchIntegrationReport> {
    const orderedProposals = validateIntegrationRequest(request);
    const normalizedProposals = [];
    for (const proposal of orderedProposals) {
      normalizedProposals.push({
        proposal,
        result: await this.repository.normalize(request.runId, proposal),
      });
    }
    const candidate = await this.repository.prepare({
      runId: request.runId,
      baseRepositoryPath: request.baseRepositoryPath,
      baseRevision: request.baseRevision,
    });
    const outcomes: PatchIntegrationOutcome[] = [];

    for (const { proposal, result } of normalizedProposals) {
      if (result.status === "rejected_ancestry") {
        outcomes.push({
          proposalId: proposal.proposalId,
          participantId: proposal.participantId,
          status: result.status,
          normalizedPatchDigest: null,
          integratedRevision: null,
          reason: result.reason,
        });
        continue;
      }
      outcomes.push(await this.repository.apply(candidate, result.patch));
    }

    return {
      schemaVersion: INTEGRATION_SCHEMA_VERSION,
      runId: request.runId,
      baseRevision: request.baseRevision,
      candidateRevision: await this.repository.currentRevision(candidate),
      candidatePath: candidate.path,
      outcomes,
    };
  }
}

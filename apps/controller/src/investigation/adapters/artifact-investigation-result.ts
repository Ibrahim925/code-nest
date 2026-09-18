import { ArtifactStore } from "../../artifacts/store.js";
import type {
  InvestigationAuthorization,
  InvestigationRequest,
} from "../domain/investigation.js";
import type {
  InvestigationExecutionResult,
  InvestigationResultPublisher,
} from "../application/ports/investigation-ports.js";

export class ArtifactInvestigationResultPublisher
  implements InvestigationResultPublisher
{
  constructor(private readonly store: ArtifactStore) {}

  async publish(
    request: InvestigationRequest,
    authorization: InvestigationAuthorization,
    result: InvestigationExecutionResult,
  ): Promise<`sha256:${string}`> {
    const reference = await this.store.put({
      runId: request.runId,
      bytes: result.bytes,
      mediaType: result.mediaType,
      redactedPreview: result.summary,
      visibility: authorization.visibility,
    });
    return reference.digest;
  }
}

import { ArtifactStore } from "../../artifacts/store.js";
import type { ReplayableIntegrationReport } from "../domain/one-round-match.js";
import type { IntegrationReportPublisher } from "../application/ports/one-round-match-ports.js";

export class ArtifactIntegrationReportPublisher
  implements IntegrationReportPublisher
{
  constructor(private readonly store: ArtifactStore) {}

  async publish(report: ReplayableIntegrationReport): Promise<`sha256:${string}`> {
    const integrated = report.outcomes.filter(
      ({ status }) => status === "integrated",
    ).length;
    const reference = await this.store.put({
      runId: report.runId,
      bytes: Buffer.from(JSON.stringify(report), "utf8"),
      mediaType: "application/json",
      redactedPreview: `${integrated}/${report.outcomes.length} proposals integrated at ${report.candidateRevision}.`,
      visibility: { class: "public" },
    });
    return reference.digest;
  }
}

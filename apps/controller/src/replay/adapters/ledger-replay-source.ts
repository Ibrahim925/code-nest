import type { EventEnvelope } from "@code-nest/protocol";

import { ArtifactStoreEvidenceReader } from "../../evidence/adapters/artifact-store-evidence-reader.js";
import type { ArtifactEvidence } from "../../evidence/domain/artifact-evidence.js";
import { EventLedger, EventLedgerError } from "../../ledger/ledger.js";
import type { ReplaySource } from "../application/ports/replay-source.js";

const PAGE_SIZE = 1_000;

export class LedgerReplaySource implements ReplaySource {
  readonly #artifacts: ArtifactStoreEvidenceReader;

  constructor(
    private readonly ledger: EventLedger,
    artifactRoot: string,
  ) {
    this.#artifacts = new ArtifactStoreEvidenceReader(artifactRoot);
  }

  listEvents(runId: string): readonly EventEnvelope[] {
    try {
      const result: EventEnvelope[] = [];
      let afterSequence = 0;
      while (true) {
        const page = this.ledger.listEvents(runId, { afterSequence, limit: PAGE_SIZE });
        result.push(...page);
        const last = page.at(-1);
        if (last === undefined || page.length < PAGE_SIZE) break;
        afterSequence = last.sequence;
      }
      return result;
    } catch (error: unknown) {
      if (error instanceof EventLedgerError) {
        throw new Error("Replay ledger read failed.", { cause: error });
      }
      throw error;
    }
  }

  readArtifact(request: Parameters<ReplaySource["readArtifact"]>[0]): Promise<ArtifactEvidence | undefined> {
    return this.#artifacts.read(request);
  }
}

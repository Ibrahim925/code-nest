import type { EventAudience, RevealState } from "@code-nest/core";
import type { EventEnvelope } from "@code-nest/protocol";

import type { ArtifactEvidence } from "../../../evidence/domain/artifact-evidence.js";

export interface ReplaySource {
  listEvents(runId: string): readonly EventEnvelope[];
  readArtifact(request: {
    readonly runId: string;
    readonly digest: string;
    readonly audience: EventAudience;
    readonly revealState: RevealState;
  }): Promise<ArtifactEvidence | undefined>;
}

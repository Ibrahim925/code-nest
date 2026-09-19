import type {
  OmpObservabilityFact,
  OmpObservabilitySink,
} from "@code-nest/adapters";

import type { RecordObservationService } from "../../observability/application/record-observation.js";
import type { ObservationContext } from "../../observability/domain/observation.js";

export class RecordObservabilitySink implements OmpObservabilitySink {
  constructor(
    private readonly service: RecordObservationService,
    private readonly runId: string,
    private readonly participantId: string,
    private readonly context: () => ObservationContext,
  ) {}

  async record(fact: OmpObservabilityFact): Promise<void> {
    await this.service.record({
      runId: this.runId,
      observationId: `${this.participantId}-${fact.observationId}`,
      participantId: this.participantId,
      source: fact.source === "participant"
        ? { kind: "participant", id: this.participantId }
        : { kind: "runtime", id: `omp-runtime-${this.participantId}` },
      context: this.context(),
      observation: fact.observation,
    });
  }
}

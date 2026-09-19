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
    const context = this.context();
    const round = context.round === null ? "r-none" : `r-${context.round}`;
    const phase = context.phase === null
      ? "p-none"
      : `p-${context.phase.replaceAll(/[^a-z0-9._-]/giu, "-")}`;
    await this.service.record({
      runId: this.runId,
      observationId: `${this.participantId}-${round}-${phase}-${fact.observationId}`,
      participantId: this.participantId,
      source: fact.source === "participant"
        ? { kind: "participant", id: this.participantId }
        : { kind: "runtime", id: `omp-runtime-${this.participantId}` },
      context,
      observation: fact.observation,
    });
  }
}

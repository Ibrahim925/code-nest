import type { ObservabilityStore } from "./ports/observability-store.js";
import {
  assertOwnMemoryAccess,
  validateObservationRequest,
  type ObservationReceipt,
  type RecordObservationRequest,
  type WorkingMemory,
} from "../domain/observation.js";

export class RecordObservationService {
  constructor(private readonly store: ObservabilityStore) {}

  async record(request: RecordObservationRequest): Promise<ObservationReceipt> {
    validateObservationRequest(request);
    return this.store.record(request);
  }

  async readOwnMemory(request: {
    readonly runId: string;
    readonly requesterId: string;
    readonly participantId: string;
  }): Promise<WorkingMemory | undefined> {
    assertOwnMemoryAccess(request.requesterId, request.participantId);
    return this.store.readLatestMemory(request.runId, request.participantId);
  }
}

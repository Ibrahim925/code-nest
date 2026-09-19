import type {
  ObservationReceipt,
  RecordObservationRequest,
  WorkingMemory,
} from "../../domain/observation.js";

export interface ObservabilityStore {
  record(request: RecordObservationRequest): Promise<ObservationReceipt>;
  readLatestMemory(
    runId: string,
    participantId: string,
  ): Promise<WorkingMemory | undefined>;
}

import type { EventEnvelope } from "@code-nest/protocol";

export interface ObserverUnblindDraft {
  readonly runId: string;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly commandId: string;
  readonly parentEventId: string;
}

export interface ObserverModeStore {
  listEvents(runId: string): EventEnvelope[];
  getCommandResult(runId: string, commandId: string): EventEnvelope | undefined;
  appendUnblinded(draft: ObserverUnblindDraft): EventEnvelope;
}

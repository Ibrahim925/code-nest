import { EVENT_SCHEMA_VERSION } from "@code-nest/protocol";

import { EventLedger, type EventDraft } from "../../ledger/ledger.js";
import type {
  OneRoundEvidence,
  OneRoundEvidenceRecorder,
} from "../../matches/application/ports/one-round-match-ports.js";

type Phase = "briefing" | "work" | "town_hall" | "integration" | "completion";

export class EventLedgerOmpLiveEvidence implements OneRoundEvidenceRecorder {
  #participants: readonly string[] = [];
  #townHallStarted = false;
  #messageIndex = 0;

  constructor(
    private readonly ledger: EventLedger,
    private readonly delegate: OneRoundEvidenceRecorder,
    private readonly options: {
      readonly createEventId: () => string;
      readonly now: () => Date;
    },
  ) {}

  async record(runId: string, evidence: OneRoundEvidence): Promise<void> {
    await this.delegate.record(runId, evidence);
    if (evidence.type === "workspaces_ready") {
      this.#participants = [...evidence.participantIds];
      this.#phase(runId, "briefing", "work");
    }
    if (evidence.type === "work_captured") {
      if (!this.#townHallStarted) {
        this.#phase(runId, "work", "town_hall");
        this.#append(runId, "town-hall-start", "town_hall.started", {
          round: 1,
          speakingOrder: [...this.#participants],
        }, "town_hall");
        this.#townHallStarted = true;
      }
      for (const body of evidence.turn.publicMessages) {
        this.#messageIndex += 1;
        const id = `message-${String(this.#messageIndex).padStart(3, "0")}`;
        this.#append(runId, id, "message.published", {
          messageId: id,
          participantId: evidence.participantId,
          channel: "town_hall",
          body,
        }, "town_hall", { kind: "participant", id: evidence.participantId });
      }
    }
    if (evidence.type === "integration_completed") {
      this.#phase(runId, "town_hall", "integration");
    }
    if (evidence.type === "match_completed") {
      this.#phase(runId, "integration", "completion");
    }
  }

  #phase(runId: string, from: Phase, to: Phase): void {
    this.#append(runId, `phase-${from}-${to}`, "match.phase_advanced", {
      from: { round: 1, phase: from },
      to: { round: 1, phase: to },
    }, to);
  }

  #append(
    runId: string,
    commandId: string,
    kind: string,
    payload: EventDraft["payload"],
    phase: Phase,
    actor: EventDraft["actor"] = { kind: "controller", id: "omp-live-match" },
  ): void {
    this.ledger.appendCommandEvent(commandId, {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: this.options.createEventId(),
      runId,
      recordedAt: this.options.now().toISOString(),
      actor,
      context: { round: 1, phase },
      kind,
      payload,
      visibility: { class: "public" },
      causationId: commandId,
      correlationId: runId,
      parentEventIds: [],
      artifactDigests: [],
      resourceCost: {},
    });
  }
}

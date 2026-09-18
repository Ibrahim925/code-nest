import { EVENT_SCHEMA_VERSION } from "@code-nest/protocol";
import type { MatchPhase } from "@code-nest/core";

import type {
  MatchResolutionFact,
  MatchResolutionJournal,
} from "../application/ports/three-round-match-ports.js";
import { EventLedger, type EventDraft } from "../../ledger/ledger.js";

export interface EventLedgerMatchResolutionOptions {
  readonly createEventId: () => string;
  readonly now: () => Date;
}

interface EventFields {
  readonly commandId: string;
  readonly kind: string;
  readonly round: number;
  readonly phase: MatchPhase;
  readonly payload: EventDraft["payload"];
  readonly visibility: EventDraft["visibility"];
}

const PUBLIC = { class: "public" } as const;
const POST_REVEAL = { class: "post_reveal" } as const;

function integrationPayload(fact: Extract<MatchResolutionFact, { type: "round_integrated" }>) {
  const { integration } = fact;
  return {
    roundId: integration.roundId,
    round: integration.round,
    baseRevision: integration.baseRevision,
    candidateRevision: integration.candidateRevision,
    outcomes: integration.outcomes.map((outcome) => ({ ...outcome })),
    governance: {
      initialCredits: integration.governance.initialCredits,
      creditsSpent: integration.governance.creditsSpent,
      activeParticipantIds: [...integration.governance.activeParticipantIds],
      quarantinedParticipantIds: [...integration.governance.quarantinedParticipantIds],
    },
  };
}

function fields(fact: MatchResolutionFact): EventFields {
  switch (fact.type) {
    case "phase_advanced":
      return {
        commandId: `phase-${fact.transition.from.round}-${fact.transition.from.phase}`,
        kind: "match.phase_advanced",
        round: fact.transition.to.round,
        phase: fact.transition.to.phase,
        payload: {
          from: { ...fact.transition.from },
          to: { ...fact.transition.to },
        },
        visibility: PUBLIC,
      };
    case "round_work_completed":
      return {
        commandId: `round-${fact.work.round}-work-completed`,
        kind: "match.round_work_completed",
        round: fact.work.round,
        phase: "work",
        payload: {
          roundId: fact.work.roundId,
          baseRevision: fact.work.baseRevision,
          participants: fact.work.participants.map((participant) => ({
            ...participant,
            publicMessages: [...participant.publicMessages],
          })),
        },
        visibility: PUBLIC,
      };
    case "round_integrated":
      return {
        commandId: `round-${fact.integration.round}-integrated`,
        kind: "match.round_integrated",
        round: fact.integration.round,
        phase: "integration",
        payload: integrationPayload(fact),
        visibility: PUBLIC,
      };
    case "candidate_frozen":
      return {
        commandId: "match-candidate-frozen",
        kind: "match.candidate_frozen",
        round: 3,
        phase: "completion",
        payload: {
          candidateRevision: fact.candidate.candidateRevision,
          candidateDigest: fact.candidate.candidateDigest,
        },
        visibility: PUBLIC,
      };
    case "legitimate_scored":
      return {
        commandId: "match-legitimate-scored",
        kind: "scoring.legitimate_completed",
        round: 3,
        phase: "completion",
        payload: {
          ...fact.result,
          assignmentScores: { ...fact.result.assignmentScores },
        },
        visibility: POST_REVEAL,
      };
    case "roles_revealed":
      return {
        commandId: "match-roles-revealed",
        kind: "match.roles_revealed",
        round: 3,
        phase: "completion",
        payload: { roles: fact.roles.map((role) => ({ ...role })) },
        visibility: POST_REVEAL,
      };
    case "covert_scored":
      return {
        commandId: "match-covert-scored",
        kind: "scoring.covert_completed",
        round: 3,
        phase: "completion",
        payload: {
          ...fact.result,
          objective: { ...fact.result.objective },
        },
        visibility: POST_REVEAL,
      };
    case "scoreboard_published":
      return {
        commandId: "match-scoreboard-published",
        kind: "match.scoreboard_published",
        round: 3,
        phase: "completion",
        payload: {
          ...fact.score,
          components: { ...fact.score.components },
        },
        visibility: POST_REVEAL,
      };
    case "match_completed":
      return {
        commandId: "match-completed",
        kind: "match.completed",
        round: 3,
        phase: "completion",
        payload: { candidateDigest: fact.candidateDigest, roundsCompleted: 3 },
        visibility: PUBLIC,
      };
  }
}

export class EventLedgerMatchResolutionJournal
  implements MatchResolutionJournal
{
  constructor(
    private readonly ledger: EventLedger,
    private readonly options: EventLedgerMatchResolutionOptions,
  ) {}

  async record(runId: string, fact: MatchResolutionFact): Promise<void> {
    const event = fields(fact);
    this.ledger.appendCommandEvent(event.commandId, {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: this.options.createEventId(),
      runId,
      recordedAt: this.options.now().toISOString(),
      actor: { kind: "controller", id: "three-round-match" },
      context: { round: event.round, phase: event.phase },
      kind: event.kind,
      payload: event.payload,
      visibility: event.visibility,
      causationId: event.commandId,
      correlationId: runId,
      parentEventIds: [],
      artifactDigests: [],
      resourceCost: {},
    });
  }
}

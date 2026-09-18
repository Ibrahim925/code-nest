import { describe, expect, it } from "vitest";

import type { DecodedEventDelivery } from "../../events/domain/live-events.js";
import { createTownHallViewState } from "../domain/town-hall.js";
import { projectTownHall } from "./project-town-hall.js";

function delivery(sequence: number, kind: string, payload: unknown): DecodedEventDelivery {
  const eventId = `event-${sequence}`;
  return {
    deliverySequence: sequence,
    eventId,
    kind,
    event: {
      eventId,
      kind,
      payload,
      actor: { kind: "controller", id: "governance" },
      context: { round: 2, phase: "town_hall" },
      recordedAt: "2026-09-18T12:00:00.000Z",
      visibility: { class: "public" },
      causationId: null,
      correlationId: null,
      parentEventIds: [],
      artifactDigests: [],
      resourceCost: {},
    },
  };
}

function started(sequence = 1): DecodedEventDelivery {
  return delivery(sequence, "town_hall.started", {
    round: 2,
    speakingOrder: ["player-a", "player-b"],
  });
}

function turn(
  sequence: number,
  participantId: string,
  pass: "evidence_accusation" | "defence_rebuttal",
  overrides: Record<string, unknown> = {},
): DecodedEventDelivery {
  return delivery(sequence, "town_hall.turn_recorded", {
    turn: {
      turnId: `turn-${sequence}`,
      participantId,
      pass,
      message: `${participantId} speaks`,
      citations: [],
      ...overrides,
    },
  });
}

function openBallot(sequence: number, overrides: Record<string, unknown> = {}) {
  return delivery(sequence, "governance.ballot_opened", {
    ballot: {
      status: "open",
      motion: {
        motionId: "motion-audit",
        proposerId: "player-a",
        kind: "fund_audit",
        action: "targeted_audit",
        subjectId: "patch-b",
      },
      eligibleVoterIds: ["player-a", "player-b"],
      requiredApprovals: 2,
      closesAt: "2026-09-18T12:05:00.000Z",
      votesSubmitted: 0,
      ...overrides,
    },
  });
}

describe("Town Hall discussion projection", () => {
  it("keeps both bounded passes, speaking order, and citation classifications", () => {
    let state = projectTownHall(createTownHallViewState(), started());
    expect(state).toMatchObject({
      status: "active",
      round: 2,
      activePass: "evidence_accusation",
      currentSpeakerId: "player-a",
    });
    state = projectTownHall(state, turn(2, "player-a", "evidence_accusation", {
      message: "Check <script>alert(1)</script> and the exact audit.",
      citations: [
        { eventId: "event-work", claimedKind: "participant.work_captured", status: "valid" },
        { eventId: "event-audit", claimedKind: "participant.work_captured", status: "mismatched" },
        { eventId: "event-hidden", claimedKind: "investigation.completed", status: "missing" },
      ],
    }));
    state = projectTownHall(state, turn(3, "player-b", "evidence_accusation", {
      message: null,
    }));
    expect(state).toMatchObject({
      activePass: "defence_rebuttal",
      currentSpeakerId: "player-a",
    });
    state = projectTownHall(state, turn(4, "player-a", "defence_rebuttal"));
    state = projectTownHall(state, turn(5, "player-b", "defence_rebuttal"));

    expect(state.status).toBe("completed");
    expect(state.turns.map(({ participantId, pass, message }) =>
      [participantId, pass, message === null ? "yield" : "message"]
    )).toEqual([
      ["player-a", "evidence_accusation", "message"],
      ["player-b", "evidence_accusation", "yield"],
      ["player-a", "defence_rebuttal", "message"],
      ["player-b", "defence_rebuttal", "message"],
    ]);
    expect(state.turns[0]?.citations.map(({ status }) => status)).toEqual([
      "valid", "mismatched", "missing",
    ]);
    expect(state.turns[0]?.message?.text).toContain("<script>");
  });

  it("ignores out-of-order, malformed, and repeated turns without inventing discussion", () => {
    const initial = projectTownHall(createTownHallViewState(), started());
    const wrongSpeaker = projectTownHall(
      initial,
      turn(2, "player-b", "evidence_accusation"),
    );
    expect(wrongSpeaker.turns).toEqual([]);
    const malformed = projectTownHall(wrongSpeaker, delivery(3, "town_hall.turn_recorded", {
      turn: { participantId: "player-a", message: "missing fields" },
    }));
    expect(malformed.turns).toEqual([]);
    expect(projectTownHall(malformed, started(2))).toBe(malformed);
  });
});

describe("sealed governance projection", () => {
  it("shows only aggregate progress while a ballot remains open", () => {
    let state = projectTownHall(createTownHallViewState(), openBallot(1));
    expect(state.ballots[0]).toMatchObject({
      status: "open",
      motionSummary: "Fund targeted audit · patch-b",
      votesSubmitted: 0,
      requiredApprovals: 2,
      votes: [],
    });
    state = projectTownHall(state, delivery(2, "governance.ballot_progress", {
      motionId: "motion-audit",
      votesSubmitted: 1,
    }));
    expect(state.ballots[0]?.votesSubmitted).toBe(1);
    const regression = projectTownHall(state, delivery(3, "governance.ballot_progress", {
      motionId: "motion-audit",
      votesSubmitted: 0,
    }));
    expect(regression.ballots[0]?.votesSubmitted).toBe(1);
  });

  it("rejects an open-ballot payload that leaks private choices", () => {
    const state = projectTownHall(createTownHallViewState(), openBallot(1, {
      votes: [{ voterId: "player-a", choice: "approve", submitted: true }],
    }));
    expect(state.ballots).toEqual([]);
  });

  it("publishes choices only on closure and distinguishes authority from applied effects", () => {
    let state = projectTownHall(createTownHallViewState(), openBallot(1));
    state = projectTownHall(state, delivery(2, "governance.ballot_closed", {
      ballot: {
        status: "passed",
        motion: {
          motionId: "motion-audit",
          proposerId: "player-a",
          kind: "fund_audit",
          action: "targeted_audit",
          subjectId: "patch-b",
        },
        eligibleVoterIds: ["player-a", "player-b"],
        requiredApprovals: 2,
        closedAt: "2026-09-18T12:05:00.000Z",
        votes: [
          { voterId: "player-a", choice: "approve", submitted: true },
          { voterId: "player-b", choice: "approve", submitted: true },
        ],
        effect: {
          kind: "audit_authorized",
          action: "targeted_audit",
          subjectId: "patch-b",
        },
      },
    }));
    expect(state.ballots[0]).toMatchObject({
      status: "passed",
      authorizedEffect: "targeted audit authorized · patch-b",
      votesSubmitted: 2,
    });
    expect(state.ballots[0]?.votes).toHaveLength(2);
    expect(state.outcomes).toEqual([]);

    state = projectTownHall(state, delivery(3, "governance.effect_applied", {
      motionId: "motion-audit",
      effect: {
        kind: "audit_authorized",
        action: "targeted_audit",
        subjectId: "patch-b",
      },
    }));
    state = projectTownHall(state, delivery(4, "governance.credits_spent", {
      action: "targeted_audit",
      subjectId: "patch-b",
      cost: 2,
      remainingCredits: 16,
    }));
    expect(state.outcomes.map(({ kind }) => kind)).toEqual([
      "effect_applied", "credits_spent",
    ]);
    expect(state.outcomes[1]).toMatchObject({ cost: 2, remainingCredits: 16 });
  });

  it("keeps bounded appeal text and office/sanction effects as factual summaries", () => {
    const appeal = openBallot(1, {
      motion: {
        motionId: "motion-appeal",
        proposerId: "player-b",
        kind: "appeal_participant_quarantine",
        participantId: "player-b",
        sanctionMotionId: "motion-sanction",
        statement: "I appeal <img src=x onerror=alert(1)>",
      },
      requiredApprovals: 1,
    });
    const state = projectTownHall(createTownHallViewState(), appeal);
    expect(state.ballots[0]).toMatchObject({
      motionSummary: "Appeal quarantine · player-b · motion-sanction",
      motionDetail: { text: "I appeal <img src=x onerror=alert(1)>" },
    });
  });
});

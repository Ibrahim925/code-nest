import { describe, expect, it } from "vitest";

import {
  MAX_TOWN_HALL_CITATIONS,
  MAX_TOWN_HALL_MESSAGE_BYTES,
  advanceTownHall,
  createTownHall,
  type TownHallEvidenceFact,
  type TownHallState,
  type TownHallTurnRequest,
} from "./town-hall.js";

const evidence: TownHallEvidenceFact[] = [
  { eventId: "event-work-a", kind: "participant.work_captured" },
  { eventId: "event-audit-b", kind: "investigation.completed" },
];

function turn(
  turnId: string,
  participantId: string,
  expectedPass: TownHallTurnRequest["expectedPass"],
  overrides: Partial<TownHallTurnRequest> = {},
): TownHallTurnRequest {
  return {
    turnId,
    participantId,
    expectedPass,
    message: `${participantId} speaks during ${expectedPass}.`,
    citations: [],
    ...overrides,
  };
}

function accepted(
  state: TownHallState,
  request: TownHallTurnRequest,
  visibleEvidence = evidence,
): TownHallState {
  return advanceTownHall(state, request, visibleEvidence).state;
}

function playTownHall(): TownHallState {
  let state: TownHallState = createTownHall(2, ["player-a", "player-b"]);
  state = accepted(state, turn("turn-a-1", "player-a", "evidence_accusation"));
  state = accepted(state, turn("turn-b-1", "player-b", "evidence_accusation", {
    message: null,
  }));
  state = accepted(state, turn("turn-a-2", "player-a", "defence_rebuttal"));
  return accepted(state, turn("turn-b-2", "player-b", "defence_rebuttal"));
}

function expectCode(operation: () => unknown, code: string): void {
  expect(operation).toThrowError(expect.objectContaining({ code }));
}

describe("bounded Town Hall", () => {
  it("runs every active speaker through evidence and defence passes in order", () => {
    let state: TownHallState = createTownHall(2, ["player-a", "player-b"]);
    expect(state).toMatchObject({
      status: "active",
      pass: "evidence_accusation",
      currentSpeakerId: "player-a",
      remainingMessageAllowance: 1,
    });

    state = accepted(state, turn("turn-a-1", "player-a", "evidence_accusation"));
    expect(state).toMatchObject({ currentSpeakerId: "player-b" });
    state = accepted(state, turn("turn-b-1", "player-b", "evidence_accusation", {
      message: null,
    }));
    expect(state).toMatchObject({
      pass: "defence_rebuttal",
      currentSpeakerId: "player-a",
    });
    state = accepted(state, turn("turn-a-2", "player-a", "defence_rebuttal"));
    state = accepted(state, turn("turn-b-2", "player-b", "defence_rebuttal"));

    expect(state.status).toBe("completed");
    expect(state.turns.map(({ participantId, pass, message }) =>
      [participantId, pass, message === null ? "yield" : "message"]
    )).toEqual([
      ["player-a", "evidence_accusation", "message"],
      ["player-b", "evidence_accusation", "yield"],
      ["player-a", "defence_rebuttal", "message"],
      ["player-b", "defence_rebuttal", "message"],
    ]);
  });

  it("labels visible citations valid or mismatched and all unavailable IDs missing", () => {
    const state = createTownHall(1, ["player-a", "player-b"]);
    const result = advanceTownHall(state, turn(
      "turn-citations", "player-a", "evidence_accusation", {
        citations: [
          { eventId: "event-work-a", claimedKind: "participant.work_captured" },
          { eventId: "event-audit-b", claimedKind: "participant.work_captured" },
          { eventId: "event-hidden", claimedKind: "investigation.completed" },
          { eventId: "event-absent", claimedKind: "investigation.completed" },
        ],
      },
    ), evidence);

    expect(result.turn.citations).toEqual([
      { eventId: "event-work-a", claimedKind: "participant.work_captured", status: "valid" },
      { eventId: "event-audit-b", claimedKind: "participant.work_captured", status: "mismatched" },
      { eventId: "event-hidden", claimedKind: "investigation.completed", status: "missing" },
      { eventId: "event-absent", claimedKind: "investigation.completed", status: "missing" },
    ]);
    expect(JSON.stringify(result.turn)).not.toContain("actualKind");
  });

  it("rejects an out-of-order speaker or pass and stops permanently at completion", () => {
    const state = createTownHall(1, ["player-a", "player-b"]);
    expectCode(() => advanceTownHall(
      state, turn("turn-wrong-speaker", "player-b", "evidence_accusation"), evidence,
    ), "STALE_TOWN_HALL_TURN");
    expectCode(() => advanceTownHall(
      state, turn("turn-wrong-pass", "player-a", "defence_rebuttal"), evidence,
    ), "STALE_TOWN_HALL_TURN");

    const completed = playTownHall();
    expectCode(() => advanceTownHall(
      completed, turn("turn-late", "player-a", "defence_rebuttal"), evidence,
    ), "TOWN_HALL_COMPLETE");
  });

  it("bounds free-form messages and citations and keeps yielded turns citation-free", () => {
    const state = createTownHall(1, ["player-a", "player-b"]);
    expectCode(() => advanceTownHall(state, turn(
      "turn-empty", "player-a", "evidence_accusation", { message: "  " },
    ), evidence), "INVALID_TOWN_HALL");
    expectCode(() => advanceTownHall(state, turn(
      "turn-long", "player-a", "evidence_accusation", {
        message: "x".repeat(MAX_TOWN_HALL_MESSAGE_BYTES + 1),
      },
    ), evidence), "INVALID_TOWN_HALL");
    expectCode(() => advanceTownHall(state, turn(
      "turn-many-citations", "player-a", "evidence_accusation", {
        citations: Array.from({ length: MAX_TOWN_HALL_CITATIONS + 1 }, (_, index) => ({
          eventId: `event-${index}`,
          claimedKind: "message.published",
        })),
      },
    ), evidence), "INVALID_TOWN_HALL");
    expectCode(() => advanceTownHall(state, turn(
      "turn-yield-citation", "player-a", "evidence_accusation", {
        message: null,
        citations: [{ eventId: "event-work-a", claimedKind: "participant.work_captured" }],
      },
    ), evidence), "INVALID_TOWN_HALL");
  });

  it("deduplicates exact turns and rejects changed turn-ID reuse", () => {
    const initial = createTownHall(1, ["player-a", "player-b"]);
    const request = turn("turn-retry", "player-a", "evidence_accusation", {
      citations: [{ eventId: "event-work-a", claimedKind: "participant.work_captured" }],
    });
    const first = advanceTownHall(initial, request, evidence);
    const retry = advanceTownHall(first.state, request, []);

    expect(retry).toEqual({ status: "duplicate", state: first.state, turn: first.turn });
    expectCode(() => advanceTownHall(first.state, {
      ...request,
      message: "Changed retry content.",
    }, evidence), "TOWN_HALL_TURN_CONFLICT");
  });

  it("rejects malformed setup and replays identical inputs deterministically", () => {
    expectCode(() => createTownHall(0, ["player-a", "player-b"]), "INVALID_TOWN_HALL");
    expectCode(() => createTownHall(1, ["player-a", "player-a"]), "INVALID_TOWN_HALL");
    expect(playTownHall()).toEqual(playTownHall());
  });
});

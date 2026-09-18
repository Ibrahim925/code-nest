import { describe, expect, it } from "vitest";

import {
  BeliefReportError,
  createPrivateBeliefReport,
  parsePrivateBeliefReport,
  sameBeliefSubmission,
  type BeliefReportSubmission,
} from "./beliefs.js";

const roster = ["player-a", "player-b", "player-c", "player-d"] as const;

function submission(
  overrides: Partial<BeliefReportSubmission> = {},
): BeliefReportSubmission {
  return {
    participantId: "player-a",
    round: 1,
    allocations: [
      { participantId: "player-b", points: 50 },
      { participantId: "player-c", points: 35 },
      { participantId: "player-d", points: 15 },
    ],
    strongestEvidenceEventId: "event-work-7",
    ...overrides,
  };
}

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrowError(expect.objectContaining({
    code: "INVALID_BELIEF_REPORT",
  }));
}

describe("private belief reports", () => {
  it("records an exact 100-point distribution over every other active player", () => {
    const report = createPrivateBeliefReport(roster, submission({
      allocations: [
        { participantId: "player-d", points: 15 },
        { participantId: "player-b", points: 50 },
        { participantId: "player-c", points: 35 },
      ],
    }));

    expect(report).toEqual({
      schemaVersion: "1.0",
      participantId: "player-a",
      round: 1,
      allocations: [
        { participantId: "player-b", points: 50 },
        { participantId: "player-c", points: 35 },
        { participantId: "player-d", points: 15 },
      ],
      strongestEvidenceEventId: "event-work-7",
    });
  });

  it("rejects totals other than 100 and fractional, negative, or oversized points", () => {
    expectInvalid(() => createPrivateBeliefReport(roster, submission({
      allocations: [
        { participantId: "player-b", points: 49 },
        { participantId: "player-c", points: 35 },
        { participantId: "player-d", points: 15 },
      ],
    })));
    for (const points of [-1, 1.5, 101]) {
      expectInvalid(() => createPrivateBeliefReport(roster, submission({
        allocations: [
          { participantId: "player-b", points },
          { participantId: "player-c", points: 0 },
          { participantId: "player-d", points: 100 - points },
        ],
      })));
    }
  });

  it("requires every other active player once and never permits self-allocation", () => {
    expectInvalid(() => createPrivateBeliefReport(roster, submission({
      allocations: [
        { participantId: "player-b", points: 50 },
        { participantId: "player-b", points: 35 },
        { participantId: "player-d", points: 15 },
      ],
    })));
    expectInvalid(() => createPrivateBeliefReport(roster, submission({
      allocations: [
        { participantId: "player-a", points: 50 },
        { participantId: "player-c", points: 35 },
        { participantId: "player-d", points: 15 },
      ],
    })));
    expectInvalid(() => createPrivateBeliefReport(roster, submission({
      allocations: [
        { participantId: "player-b", points: 50 },
        { participantId: "player-c", points: 35 },
        { participantId: "player-z", points: 15 },
      ],
    })));
  });

  it("rejects invalid rosters, rounds, evidence IDs, and unknown payload fields", () => {
    expectInvalid(() => createPrivateBeliefReport(
      ["player-a", "player-a"], submission(),
    ));
    expectInvalid(() => createPrivateBeliefReport(roster, submission({ round: 0 })));
    expectInvalid(() => createPrivateBeliefReport(roster, submission({
      strongestEvidenceEventId: "not portable!",
    })));
    expectInvalid(() => parsePrivateBeliefReport({
      ...createPrivateBeliefReport(roster, submission()),
      suspicionVerdict: "player-b",
    }));
  });

  it("compares exact normalized submissions for idempotent retries", () => {
    const report = createPrivateBeliefReport(roster, submission());
    expect(sameBeliefSubmission(report, submission({
      allocations: [...submission().allocations].reverse(),
    }))).toBe(true);
    expect(sameBeliefSubmission(report, submission({
      strongestEvidenceEventId: "event-work-8",
    }))).toBe(false);
    expect(() => sameBeliefSubmission(report, submission())).not.toThrow(BeliefReportError);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  createTownHallViewState,
  type GovernanceBallotView,
  type TownHallViewState,
} from "./domain/town-hall.js";
import { TownHall } from "./TownHall.js";

const openBallot: GovernanceBallotView = {
  motionId: "motion-audit",
  proposerId: "player-a",
  motionKind: "fund_audit",
  motionSummary: "Fund targeted audit · patch-b",
  motionDetail: null,
  status: "open",
  eligibleVoterIds: ["player-a", "player-b"],
  requiredApprovals: 2,
  votesSubmitted: 1,
  closesAt: "2026-09-18T12:05:00.000Z",
  votes: [],
  authorizedEffect: null,
};

function discussionState(): TownHallViewState {
  return {
    ...createTownHallViewState(),
    status: "active",
    round: 2,
    speakingOrder: ["player-a", "player-b", "player-c", "player-d"],
    activePass: "defence_rebuttal",
    currentSpeakerId: "player-c",
    turns: [
      {
        turnId: "turn-a-1",
        eventId: "event-turn-a",
        participantId: "player-a",
        pass: "evidence_accusation",
        message: {
          text: "This <script>alert(1)</script> change contradicts the audit.",
          truncated: false,
          format: "plain_text",
        },
        citations: [
          { eventId: "event-work", claimedKind: "participant.work_captured", status: "valid" },
          { eventId: "event-audit", claimedKind: "participant.work_captured", status: "mismatched" },
          { eventId: "event-hidden", claimedKind: "investigation.completed", status: "missing" },
        ],
      },
      {
        turnId: "turn-b-1",
        eventId: "event-turn-b",
        participantId: "player-b",
        pass: "defence_rebuttal",
        message: null,
        citations: [],
      },
    ],
    ballots: [openBallot],
    lastDeliverySequence: 8,
  };
}

function render(state: TownHallViewState): string {
  return renderToStaticMarkup(
    <TownHall
      state={state}
      canInspectCitation={(eventId) => eventId === "event-work" || eventId === "event-audit"}
      onInspectCitation={() => undefined}
    />,
  );
}

describe("Town Hall presentation", () => {
  it("stays absent until authorized discussion or governance evidence arrives", () => {
    expect(render(createTownHallViewState())).toBe("");
  });

  it("shows both passes, speaking order, safe messages, and factual citation status", () => {
    const markup = render(discussionState());
    expect(markup).toContain("Pass 1 · Evidence and accusations");
    expect(markup).toContain("Pass 2 · Defence, rebuttal, and action");
    expect(markup).toContain("player-c · defence rebuttal");
    expect(markup).toContain("Speaking now");
    expect(markup).toContain("valid");
    expect(markup).toContain("mismatched");
    expect(markup).toContain("missing");
    expect(markup).toContain("Inspect evidence");
    expect(markup).toContain("Evidence unavailable");
    expect(markup).toContain("Yielded this turn");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("shows aggregate submission progress without open-ballot choices", () => {
    const markup = render({
      ...createTownHallViewState(),
      ballots: [openBallot],
      lastDeliverySequence: 1,
    });
    expect(markup).toContain("Sealed ballot");
    expect(markup).toContain("1 of 2 submitted");
    expect(markup).toContain("Choices remain private until closure");
    expect(markup).not.toContain(">approve<");
    expect(markup).not.toContain(">reject<");
  });

  it("publishes closed votes, abstention meaning, authority, and confirmed costs separately", () => {
    const closed: GovernanceBallotView = {
      ...openBallot,
      status: "passed",
      votesSubmitted: 1,
      closesAt: "2026-09-18T12:05:01.000Z",
      votes: [
        { voterId: "player-a", choice: "approve", submitted: true },
        { voterId: "player-b", choice: "abstain", submitted: false },
      ],
      authorizedEffect: "targeted audit authorized · patch-b",
    };
    const markup = render({
      ...createTownHallViewState(),
      status: "completed",
      round: 2,
      ballots: [closed],
      outcomes: [
        {
          id: "event-effect",
          eventId: "event-effect",
          motionId: "motion-audit",
          kind: "effect_applied",
          summary: "targeted audit authorized · patch-b",
          cost: null,
          remainingCredits: null,
        },
        {
          id: "event-spend",
          eventId: "event-spend",
          motionId: null,
          kind: "credits_spent",
          summary: "targeted audit · patch-b",
          cost: 2,
          remainingCredits: 16,
        },
      ],
      lastDeliverySequence: 4,
    });
    expect(markup).toContain("passed");
    expect(markup).toContain("approve");
    expect(markup).toContain("automatic abstention · not submitted");
    expect(markup).toContain("Authority recorded; controller confirmation appears separately");
    expect(markup).toContain("Effect confirmed");
    expect(markup).toContain("Cost 2 · 16 remaining");
  });
});

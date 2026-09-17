import { describe, expect, it } from "vitest";

import {
  advanceMatchPhase,
  createMatchState,
  MatchConfigurationError,
  type AdvanceMatchPhaseRequest,
  type MatchPhase,
  type MatchState,
} from "./index";

function currentPosition(state: MatchState): AdvanceMatchPhaseRequest {
  return {
    expectedRound: state.round,
    expectedPhase: state.phase,
  };
}

function advanceSuccessfully(state: MatchState): MatchState {
  const result = advanceMatchPhase(state, currentPosition(state));

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function lastState(history: readonly MatchState[]): MatchState {
  const state = history.at(-1);
  if (state === undefined) throw new Error("Match history must not be empty.");
  return state;
}

function playToCompletion(totalRounds: number): MatchState[] {
  const history = [createMatchState({ totalRounds })];

  while (lastState(history).phase !== "completion") {
    history.push(advanceSuccessfully(lastState(history)));
  }

  return history;
}

function positions(states: readonly MatchState[]): [number, MatchPhase][] {
  return states.map((state) => [state.round, state.phase]);
}

describe("deterministic match phase state machine", () => {
  it("opens a configured match in the first round briefing", () => {
    expect(createMatchState({ totalRounds: 3 })).toEqual({
      status: "active",
      round: 1,
      totalRounds: 3,
      phase: "briefing",
    });
  });

  it("plays one briefing and three ordered rounds before completion", () => {
    const history = playToCompletion(3);

    expect(positions(history)).toEqual([
      [1, "briefing"],
      [1, "work"],
      [1, "evidence"],
      [1, "belief"],
      [1, "town_hall"],
      [1, "governance"],
      [1, "integration"],
      [2, "work"],
      [2, "evidence"],
      [2, "belief"],
      [2, "town_hall"],
      [2, "governance"],
      [2, "integration"],
      [3, "work"],
      [3, "evidence"],
      [3, "belief"],
      [3, "town_hall"],
      [3, "governance"],
      [3, "integration"],
      [3, "completion"],
    ]);
    expect(history.at(-1)).toEqual({
      status: "completed",
      round: 3,
      totalRounds: 3,
      phase: "completion",
    });
  });

  it("rolls non-final integration directly into the next round's work phase", () => {
    let state = createMatchState({ totalRounds: 2 });
    while (state.phase !== "integration") state = advanceSuccessfully(state);

    const result = advanceMatchPhase(state, currentPosition(state));

    expect(result).toEqual({
      ok: true,
      state: {
        status: "active",
        round: 2,
        totalRounds: 2,
        phase: "work",
      },
      transition: {
        from: { round: 1, phase: "integration" },
        to: { round: 2, phase: "work" },
      },
    });
  });

  it("rejects a skipped phase and preserves the current state", () => {
    const briefing = createMatchState({ totalRounds: 3 });
    const work = advanceSuccessfully(briefing);
    const result = advanceMatchPhase(work, {
      expectedRound: 1,
      expectedPhase: "evidence",
    });

    expect(result).toEqual({
      ok: false,
      state: work,
      error: {
        code: "STALE_MATCH_POSITION",
        message:
          "Advance expected round 1 evidence, but the match is at round 1 work.",
        requested: { round: 1, phase: "evidence" },
        current: { round: 1, phase: "work" },
      },
    });
    expect(briefing.phase).toBe("briefing");
  });

  it("rejects a duplicate or late advance instead of advancing twice", () => {
    const briefing = createMatchState({ totalRounds: 3 });
    const first = advanceMatchPhase(briefing, currentPosition(briefing));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);

    const duplicate = advanceMatchPhase(
      first.state,
      currentPosition(briefing),
    );

    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error("Duplicate advance was accepted.");
    expect(duplicate.error.code).toBe("STALE_MATCH_POSITION");
    expect(duplicate.state).toBe(first.state);
    expect(duplicate.state.phase).toBe("work");
  });

  it("treats completion as terminal even when the request matches it", () => {
    const completed = lastState(playToCompletion(1));
    const result = advanceMatchPhase(completed, currentPosition(completed));

    expect(result).toEqual({
      ok: false,
      state: completed,
      error: {
        code: "MATCH_ALREADY_COMPLETED",
        message: "A completed match cannot advance to another phase.",
      },
    });
  });

  it("replays the same advance requests into the same state history", () => {
    const requests: AdvanceMatchPhaseRequest[] = positions(
      playToCompletion(2).slice(0, -1),
    ).map(([expectedRound, expectedPhase]) => ({
      expectedRound,
      expectedPhase,
    }));

    function replay(): MatchState[] {
      const history = [createMatchState({ totalRounds: 2 })];
      for (const request of requests) {
        const result = advanceMatchPhase(lastState(history), request);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        history.push(result.state);
      }
      return history;
    }

    expect(replay()).toEqual(replay());
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects the invalid total round count %s",
    (totalRounds) => {
      let caught: unknown;
      try {
        createMatchState({ totalRounds });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(MatchConfigurationError);
      expect(caught).toMatchObject({
        code: "INVALID_TOTAL_ROUNDS",
        message: "Total rounds must be a positive safe integer.",
      });
    },
  );
});

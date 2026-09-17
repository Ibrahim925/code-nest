export const MATCH_PHASES = [
  "briefing",
  "work",
  "evidence",
  "belief",
  "town_hall",
  "governance",
  "integration",
  "completion",
] as const;

export type MatchPhase = (typeof MATCH_PHASES)[number];
export type ActiveMatchPhase = Exclude<MatchPhase, "completion">;

export interface MatchPosition {
  readonly round: number;
  readonly phase: MatchPhase;
}

export interface ActiveMatchState {
  readonly status: "active";
  readonly round: number;
  readonly totalRounds: number;
  readonly phase: ActiveMatchPhase;
}

export interface CompletedMatchState {
  readonly status: "completed";
  readonly round: number;
  readonly totalRounds: number;
  readonly phase: "completion";
}

export type MatchState = ActiveMatchState | CompletedMatchState;

export interface MatchConfiguration {
  readonly totalRounds: number;
}

export type MatchConfigurationErrorCode = "INVALID_TOTAL_ROUNDS";

export class MatchConfigurationError extends Error {
  override readonly name = "MatchConfigurationError";

  constructor(
    readonly code: MatchConfigurationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AdvanceMatchPhaseRequest {
  readonly expectedRound: number;
  readonly expectedPhase: MatchPhase;
}

export interface MatchPhaseTransition {
  readonly from: MatchPosition;
  readonly to: MatchPosition;
}

export interface StaleMatchPositionError {
  readonly code: "STALE_MATCH_POSITION";
  readonly message: string;
  readonly requested: MatchPosition;
  readonly current: MatchPosition;
}

export interface MatchAlreadyCompletedError {
  readonly code: "MATCH_ALREADY_COMPLETED";
  readonly message: string;
}

export type AdvanceMatchPhaseResult =
  | {
      readonly ok: true;
      readonly state: MatchState;
      readonly transition: MatchPhaseTransition;
    }
  | {
      readonly ok: false;
      readonly state: MatchState;
      readonly error: StaleMatchPositionError | MatchAlreadyCompletedError;
    };

export function createMatchState(
  configuration: MatchConfiguration,
): MatchState {
  if (
    !Number.isSafeInteger(configuration.totalRounds) ||
    configuration.totalRounds < 1
  ) {
    throw new MatchConfigurationError(
      "INVALID_TOTAL_ROUNDS",
      "Total rounds must be a positive safe integer.",
    );
  }

  return {
    status: "active",
    round: 1,
    totalRounds: configuration.totalRounds,
    phase: "briefing",
  };
}

function positionOf(state: MatchState): MatchPosition {
  return { round: state.round, phase: state.phase };
}

function nextPosition(state: ActiveMatchState): MatchPosition {
  switch (state.phase) {
    case "briefing":
      return { round: state.round, phase: "work" };
    case "work":
      return { round: state.round, phase: "evidence" };
    case "evidence":
      return { round: state.round, phase: "belief" };
    case "belief":
      return { round: state.round, phase: "town_hall" };
    case "town_hall":
      return { round: state.round, phase: "governance" };
    case "governance":
      return { round: state.round, phase: "integration" };
    case "integration":
      return state.round < state.totalRounds
        ? { round: state.round + 1, phase: "work" }
        : { round: state.round, phase: "completion" };
  }
}

function stateAfter(
  state: ActiveMatchState,
  next: MatchPosition,
): MatchState {
  return next.phase === "completion"
    ? {
        status: "completed",
        round: next.round,
        totalRounds: state.totalRounds,
        phase: "completion",
      }
    : {
        status: "active",
        round: next.round,
        totalRounds: state.totalRounds,
        phase: next.phase,
      };
}

export function advanceMatchPhase(
  state: MatchState,
  request: AdvanceMatchPhaseRequest,
): AdvanceMatchPhaseResult {
  if (state.status === "completed") {
    return {
      ok: false,
      state,
      error: {
        code: "MATCH_ALREADY_COMPLETED",
        message: "A completed match cannot advance to another phase.",
      },
    };
  }

  const current = positionOf(state);
  if (
    request.expectedRound !== current.round ||
    request.expectedPhase !== current.phase
  ) {
    const requested = {
      round: request.expectedRound,
      phase: request.expectedPhase,
    };

    return {
      ok: false,
      state,
      error: {
        code: "STALE_MATCH_POSITION",
        message: `Advance expected round ${requested.round} ${requested.phase}, but the match is at round ${current.round} ${current.phase}.`,
        requested,
        current,
      },
    };
  }

  const next = nextPosition(state);
  return {
    ok: true,
    state: stateAfter(state, next),
    transition: { from: current, to: next },
  };
}

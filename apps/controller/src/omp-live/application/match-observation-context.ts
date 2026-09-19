export interface MatchObservationPosition {
  readonly round: number | null;
  readonly phase: string | null;
}

export class MatchObservationContext {
  #position: MatchObservationPosition = { round: null, phase: null };

  current = (): MatchObservationPosition => ({ ...this.#position });

  enter(round: number, phase: string): void {
    if (!Number.isSafeInteger(round) || round < 1 || phase.trim().length === 0) {
      throw new Error("Observation context requires a valid round and phase.");
    }
    this.#position = { round, phase };
  }
}

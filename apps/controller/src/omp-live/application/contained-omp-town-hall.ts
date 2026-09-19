import {
  advanceTownHall,
  createTownHall,
  type TownHallPass,
  type TownHallState,
  type TownHallTurn,
} from "@code-nest/core";

import type { PrivateBriefSource } from "../../briefing/adapters/buffered-private-brief-channel.js";
import type { MatchParticipantRuntime } from "../../matches/application/ports/one-round-match-ports.js";
import type {
  RoundTownHallRecorder,
  RoundWorkRequest,
} from "../../matches/application/ports/three-round-match-ports.js";
import type { ParticipantWorkspace } from "../../workspaces/domain/workspace.js";
import type { MatchObservationContext } from "./match-observation-context.js";

interface TownHallRuntime extends MatchParticipantRuntime {
  deliverTownHallContext(input: {
    readonly round: number;
    readonly pass: TownHallPass;
    readonly transcript: readonly Pick<
      TownHallTurn,
      "participantId" | "pass" | "message"
    >[];
  }): Promise<void>;
}

export interface TownHallRuntimeFactory {
  createForDiscussion(
    workspace: ParticipantWorkspace,
    observationRunId: string,
  ): Promise<TownHallRuntime>;
}

export interface RoundTownHall {
  run(input: {
    readonly request: RoundWorkRequest;
    readonly workspaces: readonly ParticipantWorkspace[];
    readonly recorder: RoundTownHallRecorder;
  }): Promise<void>;
}

function failures<T>(results: readonly PromiseSettledResult<T>[]): unknown[] {
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
}

function statement(messages: readonly string[]): string | null {
  if (messages.length > 1) {
    throw new Error("A Town Hall speaker submitted more than one public statement.");
  }
  const value = messages[0]?.trim();
  if (value === undefined) return null;
  if (value.length === 0 || value.length > 4_000) {
    throw new Error("A Town Hall statement is outside its public boundary.");
  }
  return value;
}

export class ContainedOmpTownHall implements RoundTownHall {
  constructor(
    private readonly factory: TownHallRuntimeFactory,
    private readonly briefs: PrivateBriefSource,
    private readonly context: MatchObservationContext,
    private readonly budget: {
      readonly maximumOutputTokens: number;
      readonly wallTimeMilliseconds: number;
    },
  ) {}

  async run(input: {
    readonly request: RoundWorkRequest;
    readonly workspaces: readonly ParticipantWorkspace[];
    readonly recorder: RoundTownHallRecorder;
  }): Promise<void> {
    this.context.enter(input.request.round, "town_hall");
    const runtimes = new Map<string, TownHallRuntime>();
    let failure: unknown;
    try {
      const started = await Promise.allSettled(input.workspaces.map(
        async (workspace) => {
          const runtime = await this.factory.createForDiscussion(
            workspace,
            input.request.runId,
          );
          if (runtime.participantId !== workspace.participantId) {
            throw new Error("Town Hall runtime identity mismatch.");
          }
          await runtime.start({
            runId: input.request.runId,
            scenarioId: input.request.scenarioId,
            workspacePath: workspace.path,
          });
          runtimes.set(workspace.participantId, runtime);
          await runtime.deliverBrief(
            this.briefs.read(input.request.runId, workspace.participantId),
          );
        },
      ));
      const startupFailures = failures(started);
      if (startupFailures.length > 0) {
        throw new AggregateError(startupFailures, "Town Hall runtimes failed to start.");
      }
      await this.#discuss(input.request, runtimes, input.recorder);
    } catch (error: unknown) {
      failure = error;
    }
    const cleanupFailures = failures(await Promise.allSettled(
      [...runtimes.values()].map((runtime) =>
        runtime.stop(failure === undefined ? "town_hall_completed" : "controller_fault"),
      ),
    ));
    if (failure !== undefined || cleanupFailures.length > 0) {
      throw new AggregateError(
        [failure, ...cleanupFailures].filter((value) => value !== undefined),
        "Town Hall execution or cleanup failed.",
      );
    }
  }

  async #discuss(
    request: RoundWorkRequest,
    runtimes: ReadonlyMap<string, TownHallRuntime>,
    recorder: RoundTownHallRecorder,
  ): Promise<void> {
    const speakingOrder = request.participants.map(({ participantId }) => participantId);
    let state: TownHallState = createTownHall(request.round, speakingOrder);
    await recorder.record({
      type: "town_hall_started",
      round: request.round,
      speakingOrder,
    });
    for (const pass of ["evidence_accusation", "defence_rebuttal"] as TownHallPass[]) {
      for (const participantId of speakingOrder) {
        const runtime = runtimes.get(participantId);
        if (runtime === undefined) throw new Error("Town Hall runtime disappeared.");
        await runtime.deliverTownHallContext({
          round: request.round,
          pass,
          transcript: state.turns.map(({ participantId: id, pass: prior, message }) => ({
            participantId: id,
            pass: prior,
            message,
          })),
        });
        const output = await runtime.run(this.budget);
        const advanced = advanceTownHall(state, {
          turnId: `round-${request.round}-${pass}-${participantId}`,
          expectedPass: pass,
          participantId,
          message: statement(output.publicMessages),
          citations: [],
        }, []);
        state = advanced.state;
        await recorder.record({
          type: "town_hall_turn_recorded",
          round: request.round,
          turn: advanced.turn,
        });
      }
    }
  }
}

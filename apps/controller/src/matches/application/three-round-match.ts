import {
  advanceMatchPhase,
  assignParticipantRoles,
  calculateMatchScore,
  createMatchState,
  type MatchState,
} from "@code-nest/core";

import type {
  CandidateFreezer,
  FinalMatchScorer,
  MatchResolutionJournal,
  RoundExecutor,
  ThreeRoundBriefing,
  ThreeRoundRunLifecycle,
} from "./ports/three-round-match-ports.js";
import {
  THREE_ROUND_MATCH_SCHEMA_VERSION,
  ThreeRoundMatchError,
  type RevealedParticipantRole,
  type RoundIntegrationResult,
  type ThreeRoundMatchRequest,
  type ThreeRoundMatchResult,
} from "../domain/three-round-match.js";
import {
  validateCovertResult,
  validateFrozenCandidate,
  validateLegitimateResult,
  validateRoundIntegration,
  validateRoundWork,
} from "../domain/three-round-validation.js";
import { validateOneRoundMatchRequest } from "../domain/one-round-match.js";

const TOTAL_ROUNDS = 3;

export interface ThreeRoundMatchDependencies {
  readonly lifecycle: ThreeRoundRunLifecycle;
  readonly briefing: ThreeRoundBriefing;
  readonly rounds: RoundExecutor;
  readonly freezer: CandidateFreezer;
  readonly scorer: FinalMatchScorer;
  readonly journal: MatchResolutionJournal;
}

export class ThreeRoundMatchService {
  constructor(private readonly dependencies: ThreeRoundMatchDependencies) {}

  async run(input: ThreeRoundMatchRequest): Promise<ThreeRoundMatchResult> {
    const request = validateOneRoundMatchRequest(input);
    const participantIds = request.participants.map(({ participantId }) => participantId);
    const assignmentIds = request.participants.map(({ assignmentId }) => assignmentId);
    this.dependencies.lifecycle.create(request.runId, "match-create");
    await this.dependencies.briefing.brief({
      runId: request.runId,
      roleSeed: request.roleSeed,
      publicTask: request.scenario.publicTask,
      safetyBrief: request.scenario.safetyBrief,
      covertObjectiveSource: request.scenario.covertObjectiveSource,
      participants: request.participants.map((participant) => ({
        participantId: participant.participantId,
        assignment: {
          id: participant.assignmentId,
          instructions: participant.assignmentInstructions,
        },
      })),
    });

    let state = createMatchState({ totalRounds: TOTAL_ROUNDS });
    state = await this.#advance(request.runId, state);
    let repositoryPath = request.scenario.repositoryPath;
    let baseRevision = request.scenario.baseRevision;
    const integrations: RoundIntegrationResult[] = [];

    for (let round = 1; round <= TOTAL_ROUNDS; round += 1) {
      const work = await this.dependencies.rounds.runWork({
        runId: request.runId,
        round,
        scenarioId: request.scenario.scenarioId,
        repositoryPath,
        baseRevision,
        participants: request.participants.map(({ participantId, assignmentId }) => ({
          participantId,
          assignmentId,
        })),
      });
      validateRoundWork(work, round, baseRevision, participantIds);
      await this.dependencies.journal.record(request.runId, {
        type: "round_work_completed",
        work,
      });
      state = await this.#advance(request.runId, state);
      while (state.phase !== "town_hall") {
        state = await this.#advance(request.runId, state);
      }
      await this.dependencies.rounds.runTownHall(work.roundId, {
        record: (fact) => this.dependencies.journal.record(request.runId, fact),
      });
      while (state.phase !== "integration") {
        state = await this.#advance(request.runId, state);
      }

      const integration = await this.dependencies.rounds.integrate(work.roundId);
      validateRoundIntegration(integration, work, participantIds);
      await this.dependencies.journal.record(request.runId, {
        type: "round_integrated",
        integration,
      });
      integrations.push(integration);
      repositoryPath = integration.candidatePath;
      baseRevision = integration.candidateRevision;
      state = await this.#advance(request.runId, state);
    }

    if (state.status !== "completed") {
      throw new ThreeRoundMatchError(
        "ROUND_RESULT_REJECTED",
        "Three rounds did not reach completion.",
      );
    }
    const candidate = await this.dependencies.freezer.freeze({
      candidatePath: repositoryPath,
      candidateRevision: baseRevision,
    });
    validateFrozenCandidate(candidate, baseRevision);
    await this.dependencies.journal.record(request.runId, {
      type: "candidate_frozen",
      candidate,
    });

    const legitimate = await this.dependencies.scorer.scoreLegitimate(candidate);
    validateLegitimateResult(legitimate, candidate.candidateDigest, assignmentIds);
    await this.dependencies.journal.record(request.runId, {
      type: "legitimate_scored",
      result: legitimate,
    });
    const covert = await this.dependencies.scorer.scoreCovert(
      candidate,
      legitimate,
      request.roleSeed,
    );
    validateCovertResult(covert, candidate.candidateDigest);
    await this.dependencies.journal.record(request.runId, {
      type: "covert_scored",
      result: covert,
    });

    const roles: RevealedParticipantRole[] = assignParticipantRoles(
      participantIds,
      request.roleSeed,
    ).map((assignment, index) => ({
      ...assignment,
      assignmentId: assignmentIds[index] ?? "",
    }));
    await this.dependencies.journal.record(request.runId, {
      type: "roles_revealed",
      roles,
    });
    const saboteur = roles.find(({ role }) => role === "saboteur");
    const governance = integrations.at(-1)?.governance;
    if (saboteur === undefined || governance === undefined) {
      throw new ThreeRoundMatchError(
        "SCORING_RESULT_REJECTED",
        "Final role or governance state is unavailable.",
      );
    }
    const score = calculateMatchScore({
      requiredTestsPassed: legitimate.completionPassed,
      qualityScore: legitimate.qualityScore,
      covertConditionPresent: covert.conditionPresent,
      initialGovernanceCredits: governance.initialCredits,
      governanceCreditsSpent: governance.creditsSpent,
      incorrectlyQuarantinedBuilders: roles.filter(
        ({ participantId, role }) =>
          role === "builder" && governance.quarantinedParticipantIds.includes(participantId),
      ).length,
      saboteurActiveAtRelease: governance.activeParticipantIds.includes(saboteur.participantId),
      saboteurLegitimateScore: legitimate.assignmentScores[saboteur.assignmentId] ?? -1,
    });
    await this.dependencies.journal.record(request.runId, {
      type: "scoreboard_published",
      score,
    });
    await this.dependencies.journal.record(request.runId, {
      type: "match_completed",
      candidateDigest: candidate.candidateDigest,
    });
    return {
      schemaVersion: THREE_ROUND_MATCH_SCHEMA_VERSION,
      runId: request.runId,
      rounds: integrations,
      candidate,
      roles,
      legitimate,
      covert,
      score,
    };
  }

  async #advance(runId: string, state: MatchState): Promise<MatchState> {
    const advanced = advanceMatchPhase(state, {
      expectedRound: state.round,
      expectedPhase: state.phase,
    });
    if (!advanced.ok) {
      throw new ThreeRoundMatchError(
        "ROUND_RESULT_REJECTED",
        advanced.error.message,
      );
    }
    await this.dependencies.journal.record(runId, {
      type: "phase_advanced",
      transition: advanced.transition,
    });
    return advanced.state;
  }
}

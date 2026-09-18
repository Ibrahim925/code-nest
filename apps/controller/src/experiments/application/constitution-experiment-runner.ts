import {
  CONSTITUTION_IDS,
  createConstitutionExperimentPlan,
  type ConstitutionExperimentRequest,
  type PlannedConstitutionTrial,
} from "../domain/constitution-experiment.js";
import {
  summarizeConstitutionMetrics,
  validateExperimentObservation,
  type ExperimentObservation,
} from "../domain/experiment-metrics.js";
import {
  ExperimentAttemptError,
  type ConstitutionExperimentResult,
  type ExperimentAttemptRecord,
  type ExperimentMatchRunner,
  type ExperimentRecorder,
  type ExperimentTrialResult,
} from "./ports/constitution-experiment.js";

export interface ConstitutionExperimentRunnerDependencies {
  readonly matches: ExperimentMatchRunner;
  readonly recorder: ExperimentRecorder;
}

function copyObservation(observation: ExperimentObservation): ExperimentObservation {
  return Object.freeze({
    delivery: Object.freeze({ ...observation.delivery }),
    security: Object.freeze({ ...observation.security }),
    belief: Object.freeze({ ...observation.belief }),
    governance: Object.freeze({ ...observation.governance }),
  });
}

export class ConstitutionExperimentRunner {
  constructor(private readonly dependencies: ConstitutionExperimentRunnerDependencies) {}

  async run(request: ConstitutionExperimentRequest): Promise<ConstitutionExperimentResult> {
    const plan = createConstitutionExperimentPlan(request);
    await this.dependencies.recorder.record(plan.experimentId, {
      type: "experiment_started",
      plan,
    });
    const trials: ExperimentTrialResult[] = [];
    for (const trial of plan.trials) {
      trials.push(await this.#runTrial(plan, trial));
    }
    const conditions = CONSTITUTION_IDS.map((constitutionId) => {
      const conditionTrials = trials.filter((trial) => trial.constitutionId === constitutionId);
      return Object.freeze({
        constitutionId,
        repetitions: conditionTrials.length,
        metrics: summarizeConstitutionMetrics(conditionTrials.map(({ observation }) => observation)),
      });
    });
    const result: ConstitutionExperimentResult = Object.freeze({
      schemaVersion: "1.0",
      experimentId: plan.experimentId,
      scenario: plan.scenario,
      roster: plan.roster,
      trialSeeds: plan.trialSeeds,
      limits: plan.limits,
      retryPolicy: plan.retryPolicy,
      trials: Object.freeze(trials),
      conditions: Object.freeze(conditions),
    });
    await this.dependencies.recorder.record(plan.experimentId, {
      type: "experiment_completed",
      result,
    });
    return result;
  }

  async #runTrial(
    plan: ReturnType<typeof createConstitutionExperimentPlan>,
    trial: PlannedConstitutionTrial,
  ): Promise<ExperimentTrialResult> {
    const attempts: ExperimentAttemptRecord[] = [];
    let observation: ExperimentObservation | null = null;
    for (let attempt = 1; attempt <= plan.retryPolicy.maximumAttempts; attempt += 1) {
      const attemptId = `${trial.trialId}-attempt-${attempt}`;
      try {
        const received = await this.dependencies.matches.run({
          ...trial,
          attemptId,
          attempt,
          scenario: plan.scenario,
          roster: plan.roster,
          limits: plan.limits,
        });
        validateExperimentObservation(received);
        observation = copyObservation(received);
        const record = Object.freeze({
          attemptId,
          attempt,
          status: "succeeded" as const,
          failureReason: null,
        });
        attempts.push(record);
        await this.#recordAttempt(plan.experimentId, trial.trialId, record);
        break;
      } catch (error: unknown) {
        if (!(error instanceof ExperimentAttemptError)) throw error;
        const record = Object.freeze({
          attemptId,
          attempt,
          status: "failed" as const,
          failureReason: error.reason,
        });
        attempts.push(record);
        await this.#recordAttempt(plan.experimentId, trial.trialId, record);
        const retry = attempt < plan.retryPolicy.maximumAttempts &&
          plan.retryPolicy.retryableReasons.includes(error.reason);
        if (!retry) break;
      }
    }
    return Object.freeze({
      ...trial,
      attempts: Object.freeze(attempts),
      observation,
    });
  }

  async #recordAttempt(
    experimentId: string,
    trialId: string,
    attempt: ExperimentAttemptRecord,
  ): Promise<void> {
    await this.dependencies.recorder.record(experimentId, {
      type: "attempt_finished",
      trialId,
      attempt,
    });
  }
}

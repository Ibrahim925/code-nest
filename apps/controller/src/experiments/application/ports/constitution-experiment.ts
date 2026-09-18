import type {
  ConstitutionExperimentPlan,
  ExperimentLimits,
  ExperimentParticipant,
  ExperimentRetryPolicy,
  ExperimentScenario,
  PlannedConstitutionTrial,
  RetryReason,
} from "../../domain/constitution-experiment.js";
import type {
  ConstitutionSummary,
  ExperimentObservation,
} from "../../domain/experiment-metrics.js";

export interface ExperimentAttemptRequest extends PlannedConstitutionTrial {
  readonly attemptId: string;
  readonly attempt: number;
  readonly scenario: ExperimentScenario;
  readonly roster: readonly ExperimentParticipant[];
  readonly limits: ExperimentLimits;
}

export interface ExperimentMatchRunner {
  run(request: ExperimentAttemptRequest): Promise<ExperimentObservation>;
}

export interface ExperimentAttemptRecord {
  readonly attemptId: string;
  readonly attempt: number;
  readonly status: "failed" | "succeeded";
  readonly failureReason: RetryReason | null;
}

export interface ExperimentTrialResult extends PlannedConstitutionTrial {
  readonly attempts: readonly ExperimentAttemptRecord[];
  readonly observation: ExperimentObservation | null;
}

export interface ConstitutionExperimentResult {
  readonly schemaVersion: "1.0";
  readonly experimentId: string;
  readonly scenario: ExperimentScenario;
  readonly roster: readonly ExperimentParticipant[];
  readonly trialSeeds: readonly number[];
  readonly limits: ExperimentLimits;
  readonly retryPolicy: ExperimentRetryPolicy;
  readonly trials: readonly ExperimentTrialResult[];
  readonly conditions: readonly ConstitutionSummary[];
}

export type ExperimentProgressFact =
  | { readonly type: "experiment_started"; readonly plan: ConstitutionExperimentPlan }
  | {
      readonly type: "attempt_finished";
      readonly trialId: string;
      readonly attempt: ExperimentAttemptRecord;
    }
  | { readonly type: "experiment_completed"; readonly result: ConstitutionExperimentResult };

export interface ExperimentRecorder {
  record(experimentId: string, fact: ExperimentProgressFact): Promise<void>;
}

export class ExperimentAttemptError extends Error {
  constructor(readonly reason: RetryReason, message: string) {
    super(message);
    this.name = "ExperimentAttemptError";
  }
}

import { isAbsolute } from "node:path";

export const ONE_ROUND_MATCH_SCHEMA_VERSION = "1.0" as const;

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const PARTICIPANT_COUNT = 4;

export class OneRoundMatchError extends Error {
  constructor(
    readonly code:
      | "INVALID_MATCH_INPUT"
      | "RUNTIME_RESULT_REJECTED",
    message: string,
  ) {
    super(message);
    this.name = "OneRoundMatchError";
  }
}

export interface OneRoundParticipantInput {
  readonly participantId: string;
  readonly assignmentId: string;
  readonly assignmentInstructions: string;
}

export interface OneRoundScenarioInput {
  readonly scenarioId: string;
  readonly repositoryPath: string;
  readonly baseRevision: string;
  readonly publicTask: string;
  readonly safetyBrief: string;
  readonly covertObjectiveSource: Uint8Array;
}

export interface OneRoundMatchRequest {
  readonly runId: string;
  readonly roleSeed: number;
  readonly scenario: OneRoundScenarioInput;
  readonly participants: readonly OneRoundParticipantInput[];
}

export interface ReplayableIntegrationOutcome {
  readonly proposalId: string;
  readonly participantId: string;
  readonly status: "conflict" | "integrated" | "no_changes" | "rejected_ancestry";
  readonly normalizedPatchDigest: `sha256:${string}` | null;
  readonly integratedRevision: string | null;
  readonly reason: string | null;
}

export interface ReplayableIntegrationReport {
  readonly schemaVersion: "1.0";
  readonly runId: string;
  readonly baseRevision: string;
  readonly candidateRevision: string;
  readonly outcomes: readonly ReplayableIntegrationOutcome[];
}

export interface OneRoundParticipantResult {
  readonly participantId: string;
  readonly candidateRevision: string;
  readonly proposalId: string;
}

export interface OneRoundMatchResult {
  readonly schemaVersion: typeof ONE_ROUND_MATCH_SCHEMA_VERSION;
  readonly runId: string;
  readonly candidatePath: string;
  readonly candidateRevision: string;
  readonly integrationReportDigest: `sha256:${string}`;
  readonly participants: readonly OneRoundParticipantResult[];
}

function invalid(message: string): never {
  throw new OneRoundMatchError("INVALID_MATCH_INPUT", message);
}

function identifier(value: string, field: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) invalid(`${field} is not a portable identifier.`);
}

export function validateOneRoundMatchRequest(
  request: OneRoundMatchRequest,
): OneRoundMatchRequest {
  identifier(request.runId, "Run ID");
  identifier(request.scenario.scenarioId, "Scenario ID");
  if (
    !Number.isSafeInteger(request.roleSeed) ||
    request.roleSeed < 0 ||
    !isAbsolute(request.scenario.repositoryPath) ||
    !REVISION_PATTERN.test(request.scenario.baseRevision) ||
    request.scenario.publicTask.trim().length === 0 ||
    request.scenario.safetyBrief.trim().length === 0 ||
    !(request.scenario.covertObjectiveSource instanceof Uint8Array) ||
    request.scenario.covertObjectiveSource.byteLength === 0 ||
    request.participants.length !== PARTICIPANT_COUNT
  ) {
    return invalid("One-round match input is incomplete or invalid.");
  }

  const participantIds = new Set<string>();
  const assignmentIds = new Set<string>();
  for (const participant of request.participants) {
    identifier(participant.participantId, "Participant ID");
    identifier(participant.assignmentId, "Assignment ID");
    if (
      participant.assignmentInstructions.trim().length === 0 ||
      participantIds.has(participant.participantId) ||
      assignmentIds.has(participant.assignmentId)
    ) {
      return invalid("Participants require unique identities and assignments.");
    }
    participantIds.add(participant.participantId);
    assignmentIds.add(participant.assignmentId);
  }

  return {
    ...request,
    scenario: {
      ...request.scenario,
      covertObjectiveSource: new Uint8Array(
        request.scenario.covertObjectiveSource,
      ),
    },
    participants: request.participants.map((participant) => ({ ...participant })),
  };
}

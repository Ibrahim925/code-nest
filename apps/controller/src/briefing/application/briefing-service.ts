import {
  assignParticipantRoles,
  RoleAssignmentError,
  type ParticipantRole,
  type ParticipantRoleAssignment,
} from "@code-nest/core";

import type { BriefingAudit } from "./ports/briefing-audit.js";
import type { CovertObjectiveGenerator } from "./ports/covert-objective-generator.js";
import type { PrivateBriefChannel } from "./ports/private-brief-channel.js";
import {
  BriefingError,
  PRIVATE_BRIEF_SCHEMA_VERSION,
  type BriefingReceipt,
  type BriefingRequest,
  type PrivateRoleBrief,
  type SealedRoleLookup,
} from "../domain/brief.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function invalid(message: string, cause?: unknown): never {
  throw new BriefingError("INVALID_BRIEFING_INPUT", message, cause);
}

function validateRequest(request: BriefingRequest): ParticipantRoleAssignment[] {
  if (
    !IDENTIFIER_PATTERN.test(request.runId) ||
    typeof request.publicTask !== "string" ||
    request.publicTask.trim().length === 0 ||
    typeof request.safetyBrief !== "string" ||
    request.safetyBrief.trim().length === 0 ||
    !(request.covertObjectiveSource instanceof Uint8Array) ||
    request.covertObjectiveSource.byteLength === 0 ||
    !Array.isArray(request.participants)
  ) {
    return invalid("Briefing request contains invalid public or source data.");
  }

  const assignmentIds = new Set<string>();
  for (const participant of request.participants) {
    if (
      !IDENTIFIER_PATTERN.test(participant.participantId) ||
      !IDENTIFIER_PATTERN.test(participant.assignment.id) ||
      participant.assignment.instructions.trim().length === 0 ||
      assignmentIds.has(participant.assignment.id)
    ) {
      return invalid(
        "Briefing participants require unique valid assignments and instructions.",
      );
    }
    assignmentIds.add(participant.assignment.id);
  }

  try {
    return [...assignParticipantRoles(
      request.participants.map(({ participantId }) => participantId),
      request.roleSeed,
    )];
  } catch (error: unknown) {
    if (error instanceof RoleAssignmentError) {
      return invalid("Briefing role assignment input is invalid.", error);
    }
    throw error;
  }
}

function publicReceipt(request: BriefingRequest): BriefingReceipt {
  return {
    schemaVersion: PRIVATE_BRIEF_SCHEMA_VERSION,
    runId: request.runId,
    assignments: request.participants.map(({ participantId, assignment }) => ({
      participantId,
      assignmentId: assignment.id,
    })),
  };
}

function privateBrief(
  request: BriefingRequest,
  participantIndex: number,
  role: ParticipantRole,
  covertObjective: string,
): PrivateRoleBrief {
  const participant = request.participants[participantIndex];
  if (participant === undefined) {
    return invalid("Briefing participant index is unavailable.");
  }
  const common = {
    schemaVersion: PRIVATE_BRIEF_SCHEMA_VERSION,
    runId: request.runId,
    participantId: participant.participantId,
    publicTask: request.publicTask,
    safetyBrief: request.safetyBrief,
    assignment: { ...participant.assignment },
  } as const;
  return role === "saboteur"
    ? { ...common, role, covertObjective }
    : { ...common, role };
}

export class BriefingService implements SealedRoleLookup {
  readonly #attemptedRuns = new Set<string>();
  readonly #rolesByRun = new Map<string, Map<string, ParticipantRole>>();

  constructor(
    private readonly channel: PrivateBriefChannel,
    private readonly generator: CovertObjectiveGenerator,
    private readonly audit: BriefingAudit,
  ) {}

  async brief(request: BriefingRequest): Promise<BriefingReceipt> {
    const assignments = validateRequest(request);
    if (this.#attemptedRuns.has(request.runId)) {
      throw new BriefingError(
        "BRIEFING_ALREADY_ATTEMPTED",
        "Private briefing has already been attempted for this run.",
      );
    }
    this.#attemptedRuns.add(request.runId);

    const receipt = publicReceipt(request);
    let attempt;
    try {
      attempt = await this.audit.beginAttempt(receipt);
    } catch (error: unknown) {
      if (error instanceof BriefingError) throw error;
      throw new BriefingError(
        "BRIEFING_AUDIT_FAILED",
        "Private briefing could not record its one-shot attempt.",
        error,
      );
    }
    if (attempt.status === "already_started") {
      throw new BriefingError(
        "BRIEFING_ALREADY_ATTEMPTED",
        "Private briefing has already been attempted for this run.",
      );
    }

    const roleTable = new Map(
      assignments.map(({ participantId, role }) => [participantId, role]),
    );
    this.#rolesByRun.set(request.runId, roleTable);
    const saboteur = assignments.find(({ role }) => role === "saboteur");
    if (saboteur === undefined) return invalid("Briefing has no saboteur role.");

    let covertObjective: string;
    try {
      covertObjective = await this.generator.generate({
        runId: request.runId,
        roleSeed: request.roleSeed,
        participantId: saboteur.participantId,
        source: new Uint8Array(request.covertObjectiveSource),
      });
      if (covertObjective.trim().length === 0) {
        throw new Error("Generated objective is empty.");
      }
    } catch (error: unknown) {
      throw new BriefingError(
        "COVERT_OBJECTIVE_GENERATION_FAILED",
        "The private covert objective could not be generated.",
        error,
      );
    }

    try {
      for (const [index, assignment] of assignments.entries()) {
        await this.channel.deliver(
          privateBrief(request, index, assignment.role, covertObjective),
        );
      }
    } catch (error: unknown) {
      throw new BriefingError(
        "PRIVATE_BRIEF_DELIVERY_FAILED",
        "A participant private brief could not be delivered.",
        error,
      );
    }

    try {
      await this.audit.complete(receipt);
    } catch (error: unknown) {
      if (error instanceof BriefingError) throw error;
      throw new BriefingError(
        "BRIEFING_AUDIT_FAILED",
        "Private briefing completion could not be recorded.",
        error,
      );
    }
    return structuredClone(receipt);
  }

  roleForTrustedControlPlane(
    runId: string,
    participantId: string,
  ): ParticipantRole | undefined {
    return this.#rolesByRun.get(runId)?.get(participantId);
  }
}

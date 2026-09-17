export type ParticipantRole = "builder" | "saboteur";

export interface ParticipantRoleAssignment {
  readonly participantId: string;
  readonly role: ParticipantRole;
}

export type RoleAssignmentErrorCode =
  | "INVALID_PARTICIPANT_ROSTER"
  | "INVALID_ROLE_SEED";

export class RoleAssignmentError extends Error {
  constructor(readonly code: RoleAssignmentErrorCode, message: string) {
    super(message);
    this.name = "RoleAssignmentError";
  }
}

const PARTICIPANT_COUNT = 4;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function compareIdentifiers(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function assignParticipantRoles(
  participantIds: readonly string[],
  roleSeed: number,
): readonly ParticipantRoleAssignment[] {
  if (
    participantIds.length !== PARTICIPANT_COUNT ||
    participantIds.some((participantId) => !IDENTIFIER_PATTERN.test(participantId)) ||
    new Set(participantIds).size !== participantIds.length
  ) {
    throw new RoleAssignmentError(
      "INVALID_PARTICIPANT_ROSTER",
      `Role assignment requires exactly ${PARTICIPANT_COUNT} unique protocol participant IDs.`,
    );
  }
  if (!Number.isSafeInteger(roleSeed) || roleSeed < 0) {
    throw new RoleAssignmentError(
      "INVALID_ROLE_SEED",
      "Role seed must be a non-negative safe integer.",
    );
  }

  const canonicalRoster = [...participantIds].sort(compareIdentifiers);
  const saboteurId = canonicalRoster[roleSeed % PARTICIPANT_COUNT];
  return Object.freeze(
    participantIds.map((participantId) =>
      Object.freeze({
        participantId,
        role: participantId === saboteurId ? "saboteur" : "builder",
      }),
    ),
  );
}

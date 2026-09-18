import { parseEventEnvelope, type EventEnvelope } from "@code-nest/protocol";

import {
  projectEventForAudience,
  type EventAudience,
  type RevealState,
} from "./visibility.js";

export const EVIDENCE_PACKET_SCHEMA_VERSION = "1.0" as const;
export const MAX_EVIDENCE_SOURCE_EVENTS = 1_000;
export const MAX_EVIDENCE_FACTS_PER_SECTION = 256;
export const MAX_EVIDENCE_PACKET_BYTES = 256 * 1024;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PATCH_STATUSES = new Set([
  "conflict", "integrated", "no_changes", "rejected_ancestry",
]);

export class EvidencePacketError extends Error {
  constructor(
    readonly code: "EVIDENCE_PACKET_TOO_LARGE" | "INVALID_EVIDENCE_SOURCE",
    message: string,
  ) {
    super(message);
    this.name = "EvidencePacketError";
  }
}

export interface EvidencePacketRequest {
  readonly runId: string;
  readonly round: number;
  readonly audience: EventAudience;
  readonly revealState: RevealState;
  readonly events: readonly EventEnvelope[];
}

interface EvidenceReference {
  readonly eventId: string;
  readonly recordedAt: string;
}

export interface RoundEvidencePacket {
  readonly schemaVersion: typeof EVIDENCE_PACKET_SCHEMA_VERSION;
  readonly runId: string;
  readonly round: number;
  readonly sourceEventIds: readonly string[];
  readonly commits: readonly (EvidenceReference & {
    participantId: string;
    revision: string;
    summary: string;
    grade: "attributed";
  })[];
  readonly patches: readonly (EvidenceReference & {
    proposalId: string;
    participantId: string;
    status: string;
    normalizedPatchDigest: string | null;
    integratedRevision: string | null;
  })[];
  readonly conflicts: readonly (EvidenceReference & {
    proposalId: string;
    participantId: string;
    reason: string;
  })[];
  readonly authorship: readonly (EvidenceReference & {
    path: string;
    lineStart: number;
    lineEnd: number;
    participantId: string;
    revision: string;
    grade: "attributed";
  })[];
  readonly trustedResults: readonly (EvidenceReference & {
    kind: string;
    subjectId: string;
    summary: string;
    resultDigest: string;
    grade: "trusted";
  })[];
  readonly expenditures: readonly (EvidenceReference & {
    action: string;
    subjectId: string;
    cost: number;
    remainingCredits: number;
    grade: "recorded";
  })[];
  readonly claims: readonly (EvidenceReference & {
    participantId: string;
    statement: string;
    citations: readonly { eventId: string; status: "valid" | "missing" }[];
    grade: "claimed";
  })[];
  readonly unfulfilledCommitments: readonly (EvidenceReference & {
    commitmentId: string;
    participantId: string;
    statement: string;
  })[];
}

type MutablePacket = {
  -readonly [Key in keyof Omit<RoundEvidencePacket, "schemaVersion" | "runId" | "round" | "sourceEventIds">]:
    Array<RoundEvidencePacket[Key][number]>;
};

function invalid(message: string): never {
  throw new EvidencePacketError("INVALID_EVIDENCE_SOURCE", message);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`Evidence ${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalid(`Evidence ${field} must be a non-empty string.`);
  }
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalid(`Evidence ${field} must be a non-negative integer.`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  const result = integer(value, field);
  if (result === 0) return invalid(`Evidence ${field} must be positive.`);
  return result;
}

function reference(event: EventEnvelope): EvidenceReference {
  return { eventId: event.eventId, recordedAt: event.recordedAt };
}

function addWork(packet: MutablePacket, event: EventEnvelope): void {
  const payload = object(event.payload, "work payload");
  const turn = object(payload.turn, "work turn");
  packet.commits.push({
    ...reference(event),
    participantId: string(payload.participantId, "work participant"),
    revision: string(turn.candidateRevision, "candidate revision"),
    summary: string(turn.commitSummary, "commit summary"),
    grade: "attributed",
  });
}

function addIntegration(packet: MutablePacket, event: EventEnvelope): void {
  const payload = object(event.payload, "integration payload");
  const report = object(payload.report, "integration report");
  if (!Array.isArray(report.outcomes)) return invalid("Integration outcomes must be an array.");
  for (const value of report.outcomes) {
    const outcome = object(value, "integration outcome");
    const status = string(outcome.status, "patch status");
    if (!PATCH_STATUSES.has(status)) return invalid("Evidence patch status is unsupported.");
    const item = {
      ...reference(event),
      proposalId: string(outcome.proposalId, "proposal ID"),
      participantId: string(outcome.participantId, "proposal participant"),
      status,
      normalizedPatchDigest: outcome.normalizedPatchDigest === null
        ? null
        : string(outcome.normalizedPatchDigest, "patch digest"),
      integratedRevision: outcome.integratedRevision === null
        ? null
        : string(outcome.integratedRevision, "integrated revision"),
    };
    packet.patches.push(item);
    if (status === "conflict") {
      packet.conflicts.push({
        ...reference(event),
        proposalId: item.proposalId,
        participantId: item.participantId,
        reason: string(outcome.reason, "conflict reason"),
      });
    }
  }
}

function addAuthorship(packet: MutablePacket, event: EventEnvelope): void {
  const payload = object(event.payload, "provenance payload");
  if (!Array.isArray(payload.entries)) return invalid("Provenance entries must be an array.");
  for (const value of payload.entries) {
    const entry = object(value, "provenance entry");
    const lineStart = positiveInteger(entry.lineStart, "authorship start line");
    const lineEnd = positiveInteger(entry.lineEnd, "authorship end line");
    if (lineEnd < lineStart) return invalid("Evidence authorship line range is reversed.");
    packet.authorship.push({
      ...reference(event),
      path: string(entry.path, "authorship path"),
      lineStart,
      lineEnd,
      participantId: string(entry.participantId, "authorship participant"),
      revision: string(entry.revision, "authorship revision"),
      grade: "attributed",
    });
  }
}

function addInvestigation(packet: MutablePacket, event: EventEnvelope): void {
  const payload = object(event.payload, "investigation payload");
  const receipt = object(payload.receipt, "investigation receipt");
  const request = object(receipt.request, "investigation request");
  packet.trustedResults.push({
    ...reference(event),
    kind: string(request.kind, "investigation kind"),
    subjectId: string(request.subjectId, "investigation subject"),
    summary: string(receipt.summary, "investigation summary"),
    resultDigest: string(receipt.resultDigest, "investigation result digest"),
    grade: "trusted",
  });
}

function addExpenditure(packet: MutablePacket, event: EventEnvelope): void {
  const payload = object(event.payload, "expenditure payload");
  packet.expenditures.push({
    ...reference(event),
    action: string(payload.action, "expenditure action"),
    subjectId: string(payload.subjectId, "expenditure subject"),
    cost: integer(payload.cost, "expenditure cost"),
    remainingCredits: integer(payload.remainingCredits, "remaining credits"),
    grade: "recorded",
  });
}

function addClaim(
  packet: MutablePacket,
  event: EventEnvelope,
  visibleEventIds: ReadonlySet<string>,
): void {
  const payload = object(event.payload, "claim payload");
  if (!Array.isArray(payload.citedEventIds)) return invalid("Claim citations must be an array.");
  packet.claims.push({
    ...reference(event),
    participantId: string(payload.participantId, "claim participant"),
    statement: string(payload.claim, "claim statement"),
    citations: payload.citedEventIds.map((value) => {
      const eventId = string(value, "citation event ID");
      return { eventId, status: visibleEventIds.has(eventId) ? "valid" : "missing" };
    }),
    grade: "claimed",
  });
}

function addEvent(
  packet: MutablePacket,
  event: EventEnvelope,
  visibleEventIds: ReadonlySet<string>,
): void {
  if (event.kind === "participant.work_captured") addWork(packet, event);
  else if (event.kind === "integration.completed") addIntegration(packet, event);
  else if (event.kind === "provenance.recorded") addAuthorship(packet, event);
  else if (event.kind === "investigation.completed") addInvestigation(packet, event);
  else if (event.kind === "governance.credits_spent") addExpenditure(packet, event);
  else if (event.kind === "message.published") addClaim(packet, event, visibleEventIds);
}

function commitments(
  packet: MutablePacket,
  events: readonly EventEnvelope[],
): void {
  const fulfilled = new Set<string>();
  for (const event of events) {
    if (event.kind !== "commitment.fulfilled") continue;
    const payload = object(event.payload, "fulfilled commitment payload");
    fulfilled.add(string(payload.commitmentId, "fulfilled commitment ID"));
  }
  for (const event of events) {
    if (event.kind !== "commitment.created") continue;
    const payload = object(event.payload, "commitment payload");
    const commitmentId = string(payload.commitmentId, "commitment ID");
    if (fulfilled.has(commitmentId)) continue;
    packet.unfulfilledCommitments.push({
      ...reference(event),
      commitmentId,
      participantId: string(payload.participantId, "commitment participant"),
      statement: string(payload.statement, "commitment statement"),
    });
  }
}

function enforceBounds(packet: RoundEvidencePacket): void {
  const sections = [
    packet.commits, packet.patches, packet.conflicts, packet.authorship,
    packet.trustedResults, packet.expenditures, packet.claims,
    packet.unfulfilledCommitments,
  ];
  for (const section of sections) {
    if (section.length > MAX_EVIDENCE_FACTS_PER_SECTION) {
      throw new EvidencePacketError("EVIDENCE_PACKET_TOO_LARGE", "Evidence section exceeds its fact limit.");
    }
  }
  if (new TextEncoder().encode(JSON.stringify(packet)).byteLength > MAX_EVIDENCE_PACKET_BYTES) {
    throw new EvidencePacketError("EVIDENCE_PACKET_TOO_LARGE", "Evidence packet exceeds its byte limit.");
  }
}

export function buildRoundEvidencePacket(
  request: EvidencePacketRequest,
): RoundEvidencePacket {
  if (!IDENTIFIER_PATTERN.test(request.runId) || !Number.isSafeInteger(request.round) || request.round < 1) {
    return invalid("Evidence request must name a portable run and positive round.");
  }
  if (request.events.length > MAX_EVIDENCE_SOURCE_EVENTS) {
    throw new EvidencePacketError("EVIDENCE_PACKET_TOO_LARGE", "Evidence source exceeds its event limit.");
  }
  for (const event of request.events) {
    if (!parseEventEnvelope(event).ok || event.runId !== request.runId) {
      return invalid("Evidence source contains an invalid or foreign event.");
    }
  }
  const ordered = [...request.events].sort((left, right) => left.sequence - right.sequence);
  if (ordered.some((event, index) => index > 0 && event.sequence === ordered[index - 1]?.sequence)) {
    return invalid("Evidence source contains duplicate ledger sequences.");
  }
  const visible = ordered.filter((event) =>
    event.context.round === request.round &&
    projectEventForAudience(event, request) !== undefined,
  );
  const visibleEventIds = new Set(visible.map(({ eventId }) => eventId));
  const mutable: MutablePacket = {
    commits: [], patches: [], conflicts: [], authorship: [], trustedResults: [],
    expenditures: [], claims: [], unfulfilledCommitments: [],
  };
  for (const event of visible) addEvent(mutable, event, visibleEventIds);
  commitments(mutable, visible);
  const packet: RoundEvidencePacket = {
    schemaVersion: EVIDENCE_PACKET_SCHEMA_VERSION,
    runId: request.runId,
    round: request.round,
    sourceEventIds: visible.map(({ eventId }) => eventId),
    ...mutable,
  };
  enforceBounds(packet);
  return packet;
}

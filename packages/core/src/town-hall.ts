export const TOWN_HALL_SCHEMA_VERSION = "1.0" as const;
export const MAX_TOWN_HALL_MESSAGE_BYTES = 4_096;
export const MAX_TOWN_HALL_CITATIONS = 8;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KIND_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_PARTICIPANTS = 64;

export type TownHallPass = "evidence_accusation" | "defence_rebuttal";
export type CitationStatus = "valid" | "mismatched" | "missing";

export class TownHallError extends Error {
  constructor(
    readonly code:
      | "INVALID_TOWN_HALL"
      | "STALE_TOWN_HALL_TURN"
      | "TOWN_HALL_COMPLETE"
      | "TOWN_HALL_TURN_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "TownHallError";
  }
}

export interface TownHallEvidenceFact {
  readonly eventId: string;
  readonly kind: string;
}

export interface TownHallCitationRequest {
  readonly eventId: string;
  readonly claimedKind: string;
}

export interface TownHallCitation extends TownHallCitationRequest {
  readonly status: CitationStatus;
}

export interface TownHallTurnRequest {
  readonly turnId: string;
  readonly expectedPass: TownHallPass;
  readonly participantId: string;
  readonly message: string | null;
  readonly citations: readonly TownHallCitationRequest[];
}

export interface TownHallTurn {
  readonly turnId: string;
  readonly pass: TownHallPass;
  readonly participantId: string;
  readonly message: string | null;
  readonly citations: readonly TownHallCitation[];
}

interface TownHallBaseState {
  readonly schemaVersion: typeof TOWN_HALL_SCHEMA_VERSION;
  readonly round: number;
  readonly speakingOrder: readonly string[];
  readonly turns: readonly TownHallTurn[];
}

export interface ActiveTownHallState extends TownHallBaseState {
  readonly status: "active";
  readonly pass: TownHallPass;
  readonly currentSpeakerIndex: number;
  readonly currentSpeakerId: string;
  readonly remainingMessageAllowance: 1;
}

export interface CompletedTownHallState extends TownHallBaseState {
  readonly status: "completed";
  readonly pass: "defence_rebuttal";
}

export type TownHallState = ActiveTownHallState | CompletedTownHallState;

export interface TownHallAdvanceResult {
  readonly status: "accepted" | "duplicate";
  readonly state: TownHallState;
  readonly turn: TownHallTurn;
}

function fail(
  code: TownHallError["code"],
  message: string,
): never {
  throw new TownHallError(code, message);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return fail("INVALID_TOWN_HALL", `Town Hall ${field} must be a portable identifier.`);
  }
  return value;
}

function validPass(value: unknown): value is TownHallPass {
  return value === "evidence_accusation" || value === "defence_rebuttal";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evidenceMap(facts: readonly TownHallEvidenceFact[]): Map<string, string> {
  if (!Array.isArray(facts) || facts.length > 1_000) {
    return fail("INVALID_TOWN_HALL", "Town Hall visible evidence index is invalid.");
  }
  const result = new Map<string, string>();
  for (const fact of facts) {
    if (!isRecord(fact)) {
      return fail("INVALID_TOWN_HALL", "Town Hall evidence fact must be an object.");
    }
    const eventId = identifier(fact.eventId, "evidence event ID");
    if (typeof fact.kind !== "string" || !KIND_PATTERN.test(fact.kind) || result.has(eventId)) {
      return fail("INVALID_TOWN_HALL", "Town Hall evidence facts require unique IDs and valid kinds.");
    }
    result.set(eventId, fact.kind);
  }
  return result;
}

function classifyCitations(
  citations: readonly TownHallCitationRequest[],
  evidence: ReadonlyMap<string, string>,
): TownHallCitation[] {
  if (!Array.isArray(citations) || citations.length > MAX_TOWN_HALL_CITATIONS) {
    return fail("INVALID_TOWN_HALL", "Town Hall citations exceed their limit.");
  }
  const seen = new Set<string>();
  return citations.map((citation) => {
    if (!isRecord(citation)) {
      return fail("INVALID_TOWN_HALL", "Town Hall citation must be an object.");
    }
    const eventId = identifier(citation.eventId, "citation event ID");
    if (
      seen.has(eventId) || typeof citation.claimedKind !== "string" ||
      !KIND_PATTERN.test(citation.claimedKind)
    ) {
      return fail("INVALID_TOWN_HALL", "Town Hall citations require unique IDs and valid claimed kinds.");
    }
    seen.add(eventId);
    const actualKind = evidence.get(eventId);
    const status = actualKind === undefined
      ? "missing"
      : actualKind === citation.claimedKind ? "valid" : "mismatched";
    return { eventId, claimedKind: citation.claimedKind, status };
  });
}

function validateMessage(message: unknown, citationCount: number): string | null {
  if (message === null) {
    if (citationCount !== 0) {
      return fail("INVALID_TOWN_HALL", "A yielded Town Hall turn cannot cite evidence.");
    }
    return null;
  }
  if (
    typeof message !== "string" || message.trim().length === 0 ||
    new TextEncoder().encode(message).byteLength > MAX_TOWN_HALL_MESSAGE_BYTES
  ) {
    return fail("INVALID_TOWN_HALL", "Town Hall message must be non-empty and within its byte limit.");
  }
  return message;
}

function speakerAt(speakingOrder: readonly string[], index: number): string {
  const participantId = speakingOrder[index];
  if (participantId === undefined) {
    return fail("INVALID_TOWN_HALL", "Town Hall speaking order is inconsistent.");
  }
  return participantId;
}

export function createTownHall(
  round: number,
  speakingOrder: readonly string[],
): ActiveTownHallState {
  if (!Number.isSafeInteger(round) || round < 1) {
    return fail("INVALID_TOWN_HALL", "Town Hall round must be a positive safe integer.");
  }
  if (
    !Array.isArray(speakingOrder) || speakingOrder.length < 2 ||
    speakingOrder.length > MAX_PARTICIPANTS ||
    speakingOrder.some((participantId) => !IDENTIFIER_PATTERN.test(participantId)) ||
    new Set(speakingOrder).size !== speakingOrder.length
  ) {
    return fail("INVALID_TOWN_HALL", "Town Hall requires two to 64 unique active participants.");
  }
  return {
    schemaVersion: TOWN_HALL_SCHEMA_VERSION,
    status: "active",
    round,
    pass: "evidence_accusation",
    speakingOrder: [...speakingOrder],
    currentSpeakerIndex: 0,
    currentSpeakerId: speakerAt(speakingOrder, 0),
    remainingMessageAllowance: 1,
    turns: [],
  };
}

function sameTurn(turn: TownHallTurn, request: TownHallTurnRequest): boolean {
  return turn.pass === request.expectedPass && turn.participantId === request.participantId &&
    turn.message === request.message && turn.citations.length === request.citations.length &&
    turn.citations.every((citation, index) =>
      citation.eventId === request.citations[index]?.eventId &&
      citation.claimedKind === request.citations[index]?.claimedKind
    );
}

function nextState(state: ActiveTownHallState, turn: TownHallTurn): TownHallState {
  const turns = [...state.turns, turn];
  const hasNextSpeaker = state.currentSpeakerIndex + 1 < state.speakingOrder.length;
  if (hasNextSpeaker) {
    const currentSpeakerIndex = state.currentSpeakerIndex + 1;
    return {
      ...state,
      currentSpeakerIndex,
      currentSpeakerId: speakerAt(state.speakingOrder, currentSpeakerIndex),
      turns,
    };
  }
  if (state.pass === "evidence_accusation") {
    return {
      ...state,
      pass: "defence_rebuttal",
      currentSpeakerIndex: 0,
      currentSpeakerId: speakerAt(state.speakingOrder, 0),
      turns,
    };
  }
  return {
    schemaVersion: state.schemaVersion,
    status: "completed",
    round: state.round,
    pass: "defence_rebuttal",
    speakingOrder: state.speakingOrder,
    turns,
  };
}

export function advanceTownHall(
  state: TownHallState,
  request: TownHallTurnRequest,
  visibleEvidence: readonly TownHallEvidenceFact[],
): TownHallAdvanceResult {
  identifier(request.turnId, "turn ID");
  identifier(request.participantId, "participant ID");
  if (!validPass(request.expectedPass)) {
    return fail("INVALID_TOWN_HALL", "Town Hall pass is invalid.");
  }
  const previous = state.turns.find(({ turnId }) => turnId === request.turnId);
  if (previous !== undefined) {
    if (!sameTurn(previous, request)) {
      return fail("TOWN_HALL_TURN_CONFLICT", "Town Hall turn ID was already used differently.");
    }
    return { status: "duplicate", state, turn: previous };
  }
  if (state.status === "completed") {
    return fail("TOWN_HALL_COMPLETE", "Completed Town Hall discussion cannot accept another turn.");
  }
  if (request.expectedPass !== state.pass || request.participantId !== state.currentSpeakerId) {
    return fail("STALE_TOWN_HALL_TURN", "Town Hall turn does not match the current pass and speaker.");
  }
  if (!Array.isArray(request.citations)) {
    return fail("INVALID_TOWN_HALL", "Town Hall citations must be an array.");
  }
  const message = validateMessage(request.message, request.citations.length);
  const turn: TownHallTurn = {
    turnId: request.turnId,
    pass: state.pass,
    participantId: request.participantId,
    message,
    citations: classifyCitations(request.citations, evidenceMap(visibleEvidence)),
  };
  return { status: "accepted", state: nextState(state, turn), turn };
}

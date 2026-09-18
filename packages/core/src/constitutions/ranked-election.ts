import { ConstitutionError } from "./constitution.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface RankedElectionBallot {
  readonly voterId: string;
  readonly rankings: readonly string[];
}

export interface RankedElectionRound {
  readonly counts: readonly { readonly candidateId: string; readonly votes: number }[];
  readonly eliminatedCandidateId: string | null;
}

export interface RankedElectionResult {
  readonly winnerId: string;
  readonly rounds: readonly RankedElectionRound[];
}

function invalid(message: string): never {
  throw new ConstitutionError("INVALID_CONSTITUTION_ACTION", message);
}

export function electMaintainer(
  participantIds: readonly string[],
  ballots: readonly RankedElectionBallot[],
): RankedElectionResult {
  if (
    participantIds.length < 2 || participantIds.length > 64 ||
    participantIds.some((id) => !IDENTIFIER_PATTERN.test(id)) ||
    new Set(participantIds).size !== participantIds.length ||
    !Array.isArray(ballots) || ballots.length !== participantIds.length
  ) {
    return invalid("Maintainer election requires a valid active roster and one ballot per voter.");
  }
  const candidates = [...participantIds].sort();
  const roster = new Set(candidates);
  const voters = new Set<string>();
  const validatedBallots: { voterId: string; rankings: string[] }[] = [];
  for (const ballot of ballots) {
    const rankings: unknown = ballot.rankings;
    if (
      !roster.has(ballot.voterId) || voters.has(ballot.voterId) ||
      !Array.isArray(rankings) || rankings.length !== candidates.length ||
      rankings.some((candidateId) => typeof candidateId !== "string")
    ) {
      return invalid("Maintainer ranked ballots must be complete unique roster permutations.");
    }
    const rankingIds = rankings as string[];
    if (
      new Set(rankingIds).size !== candidates.length ||
      rankingIds.some((candidateId) => !roster.has(candidateId))
    ) {
      return invalid("Maintainer ranked ballots must be complete unique roster permutations.");
    }
    voters.add(ballot.voterId);
    validatedBallots.push({ voterId: ballot.voterId, rankings: rankingIds });
  }

  const active = new Set(candidates);
  const rounds: RankedElectionRound[] = [];
  while (active.size > 0) {
    const counts = [...active].sort().map((candidateId) => ({ candidateId, votes: 0 }));
    const byCandidate = new Map(counts.map((count) => [count.candidateId, count]));
    for (const ballot of validatedBallots) {
      const choice = ballot.rankings.find((candidateId) => active.has(candidateId));
      if (choice === undefined) return invalid("Maintainer ballot exhausted unexpectedly.");
      const count = byCandidate.get(choice);
      if (count === undefined) return invalid("Maintainer election count is inconsistent.");
      count.votes += 1;
    }
    const winner = counts.find(({ votes }) => votes > ballots.length / 2);
    if (winner !== undefined || counts.length === 1) {
      const winnerId = winner?.candidateId ?? counts[0]?.candidateId;
      if (winnerId === undefined) return invalid("Maintainer election has no winner.");
      rounds.push({ counts, eliminatedCandidateId: null });
      return { winnerId, rounds };
    }
    const minimum = Math.min(...counts.map(({ votes }) => votes));
    const eliminatedCandidateId = counts
      .filter(({ votes }) => votes === minimum)
      .map(({ candidateId }) => candidateId)
      .sort()
      .at(-1);
    if (eliminatedCandidateId === undefined) return invalid("Maintainer election cannot eliminate.");
    rounds.push({ counts, eliminatedCandidateId });
    active.delete(eliminatedCandidateId);
  }
  return invalid("Maintainer election has no candidates.");
}

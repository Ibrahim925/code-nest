import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import type { CandidateFreezer } from "../application/ports/three-round-match-ports.js";
import {
  ThreeRoundMatchError,
  type FrozenCandidate,
} from "../domain/three-round-match.js";
import { gitText, runGit } from "../../git/git-command.js";

const REVISION_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export class GitCandidateFreezer implements CandidateFreezer {
  async freeze(request: {
    readonly candidatePath: string;
    readonly candidateRevision: string;
  }): Promise<FrozenCandidate> {
    if (
      !isAbsolute(request.candidatePath) ||
      request.candidatePath.includes("\0") ||
      !REVISION_PATTERN.test(request.candidateRevision)
    ) {
      throw new ThreeRoundMatchError(
        "CANDIDATE_FREEZE_REJECTED",
        "Candidate freeze input is invalid.",
      );
    }
    try {
      const [head, status] = await Promise.all([
        runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
          cwd: request.candidatePath,
        }),
        runGit(["status", "--porcelain=v1", "--untracked-files=all"], {
          cwd: request.candidatePath,
        }),
      ]);
      if (
        gitText(head.stdout).trim() !== request.candidateRevision ||
        status.stdout.byteLength !== 0
      ) {
        throw new Error("Candidate is dirty or points at another revision.");
      }
      const archive = await runGit(
        ["archive", "--format=tar", request.candidateRevision],
        { cwd: request.candidatePath },
      );
      return Object.freeze({
        candidatePath: request.candidatePath,
        candidateRevision: request.candidateRevision,
        candidateDigest: `sha256:${createHash("sha256").update(archive.stdout).digest("hex")}`,
      });
    } catch (error: unknown) {
      if (error instanceof ThreeRoundMatchError) throw error;
      throw new ThreeRoundMatchError(
        "CANDIDATE_FREEZE_REJECTED",
        "Candidate must be one clean committed revision before scoring.",
        error,
      );
    }
  }
}

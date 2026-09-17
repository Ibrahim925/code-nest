import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  GIT_COMMAND_OVERHEAD_BYTES,
  gitText,
  runGit,
} from "../../git/git-command.js";
import type { PatchNormalizationResult } from "../application/ports/patch-integration-repository.js";
import {
  IntegrationError,
  type AuthorizedPatchProposal,
} from "../domain/integration.js";

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function inside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot.length > 0 &&
    !pathFromRoot.startsWith("..") &&
    !isAbsolute(pathFromRoot)
  );
}

async function assertManagedSource(
  workspaceRoot: string,
  runId: string,
  participantId: string,
  sourcePath: string,
): Promise<void> {
  const lexicalSource = resolve(sourcePath);
  const expectedSource = resolve(workspaceRoot, runId, participantId);
  if (lexicalSource !== expectedSource || !inside(workspaceRoot, lexicalSource)) {
    throw new IntegrationError(
      "INVALID_INTEGRATION_INPUT",
      "Patch source must remain inside the managed workspace root.",
    );
  }
  const [realRoot, realSource] = await Promise.all([
    realpath(workspaceRoot),
    realpath(lexicalSource),
  ]);
  const metadata = await lstat(join(realSource, ".git"));
  if (!inside(realRoot, realSource) || !metadata.isDirectory()) {
    throw new IntegrationError(
      "INVALID_INTEGRATION_INPUT",
      "Patch source must be a managed repository with private Git metadata.",
    );
  }
}

export async function normalizeGitPatch(
  workspaceRoot: string,
  maximumPatchBytes: number,
  runId: string,
  proposal: AuthorizedPatchProposal,
): Promise<PatchNormalizationResult> {
  try {
    await assertManagedSource(
      workspaceRoot,
      runId,
      proposal.participantId,
      proposal.sourceRepositoryPath,
    );
    const actualCandidate = gitText(
      (
        await runGit(
          ["rev-parse", "--verify", `${proposal.candidateRevision}^{commit}`],
          { cwd: proposal.sourceRepositoryPath },
        )
      ).stdout,
    ).trim();
    if (actualCandidate !== proposal.candidateRevision) {
      throw new Error("Candidate resolved to an unexpected revision.");
    }
    const ancestry = await runGit(
      [
        "merge-base",
        "--is-ancestor",
        proposal.baseRevision,
        proposal.candidateRevision,
      ],
      { allowedExitCodes: [0, 1], cwd: proposal.sourceRepositoryPath },
    );
    if (ancestry.exitCode === 1) {
      return {
        status: "rejected_ancestry",
        reason: "Candidate is not descended from the declared base revision.",
      };
    }
    const bytes = (
      await runGit(
        [
          "diff",
          "--binary",
          "--full-index",
          "--no-ext-diff",
          proposal.baseRevision,
          proposal.candidateRevision,
          "--",
        ],
        {
          cwd: proposal.sourceRepositoryPath,
          maximumBytes: maximumPatchBytes + GIT_COMMAND_OVERHEAD_BYTES,
        },
      )
    ).stdout;
    if (bytes.byteLength > maximumPatchBytes) {
      throw new Error("Normalized patch exceeds the configured byte limit.");
    }
    return {
      status: "normalized",
      patch: {
        proposalId: proposal.proposalId,
        participantId: proposal.participantId,
        digest: digest(bytes),
        bytes: Buffer.from(bytes),
      },
    };
  } catch (error: unknown) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(
      "PATCH_NORMALIZATION_FAILED",
      "Authorized patch normalization failed.",
      error,
    );
  }
}

import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  gitText,
  isNodeErrorWithCode,
  runGit,
} from "../../git/git-command.js";
import type {
  NormalizedPatch,
  PrepareReleaseCandidateRequest,
  ReleaseCandidate,
} from "../application/ports/patch-integration-repository.js";
import {
  IntegrationError,
  type PatchIntegrationOutcome,
} from "../domain/integration.js";

const COMMIT_DATE = "2000-01-01T00:00:00Z";

function inside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot.length > 0 &&
    !pathFromRoot.startsWith("..") &&
    !isAbsolute(pathFromRoot)
  );
}

export async function prepareReleaseCandidate(
  releaseRoot: string,
  request: PrepareReleaseCandidateRequest,
): Promise<ReleaseCandidate> {
  const candidatePath = resolve(releaseRoot, request.runId);
  if (!inside(releaseRoot, candidatePath)) {
    throw new IntegrationError(
      "INVALID_INTEGRATION_INPUT",
      "Release candidate must remain inside the controller release root.",
    );
  }
  await mkdir(releaseRoot, { mode: 0o700, recursive: true });
  try {
    await mkdir(candidatePath, { mode: 0o700 });
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "EEXIST")) {
      throw new IntegrationError(
        "RELEASE_CANDIDATE_EXISTS",
        "A release candidate already exists for this run.",
        error,
      );
    }
    throw preparationFailure(error);
  }

  try {
    await runGit([
      "clone",
      "--no-hardlinks",
      "--no-checkout",
      "--no-tags",
      "--quiet",
      "--",
      request.baseRepositoryPath,
      candidatePath,
    ]);
    await chmod(candidatePath, 0o700);
    await runGit(["checkout", "--detach", request.baseRevision, "--"], {
      cwd: candidatePath,
    });
    const actualBase = await readCandidateRevision({
      path: candidatePath,
      baseRevision: request.baseRevision,
    });
    if (actualBase !== request.baseRevision) {
      throw new Error("Release candidate resolved to an unexpected base.");
    }
    await runGit(["remote", "remove", "origin"], { cwd: candidatePath });
    await runGit(["config", "user.name", "Code Nest Integrator"], {
      cwd: candidatePath,
    });
    await runGit(
      ["config", "user.email", "integrator@code-nest.invalid"],
      { cwd: candidatePath },
    );
    return { path: candidatePath, baseRevision: request.baseRevision };
  } catch (error: unknown) {
    await rm(candidatePath, { force: true, recursive: true });
    throw preparationFailure(error);
  }
}

export async function applyNormalizedPatch(
  candidate: ReleaseCandidate,
  patch: NormalizedPatch,
): Promise<PatchIntegrationOutcome> {
  if (patch.bytes.byteLength === 0) {
    return outcome(patch, "no_changes", null, "Patch contains no changes.");
  }
  const patchPath = join(
    candidate.path,
    ".git",
    `code-nest-${patch.digest.slice("sha256:".length)}.patch`,
  );
  try {
    await writeFile(patchPath, patch.bytes, { flag: "wx", mode: 0o600 });
    const application = await runGit(
      [
        "apply",
        "--3way",
        "--index",
        "--whitespace=error-all",
        "--",
        patchPath,
      ],
      { allowedExitCodes: [0, 1], cwd: candidate.path },
    );
    if (application.exitCode === 1) {
      await runGit(["reset", "--hard", "--quiet", "HEAD"], {
        cwd: candidate.path,
      });
      return outcome(
        patch,
        "conflict",
        null,
        "Patch does not apply cleanly in the declared order.",
      );
    }
    await runGit(
      [
        "commit",
        "--quiet",
        "--no-gpg-sign",
        "--no-verify",
        "-m",
        `Integrate ${patch.proposalId} from ${patch.participantId}`,
      ],
      {
        cwd: candidate.path,
        environment: {
          GIT_AUTHOR_DATE: COMMIT_DATE,
          GIT_COMMITTER_DATE: COMMIT_DATE,
        },
      },
    );
    return outcome(patch, "integrated", await readCandidateRevision(candidate), null);
  } catch (error: unknown) {
    throw new IntegrationError(
      "PATCH_APPLICATION_FAILED",
      "Normalized patch application failed.",
      error,
    );
  } finally {
    await rm(patchPath, { force: true });
  }
}

export async function readCandidateRevision(
  candidate: ReleaseCandidate,
): Promise<string> {
  try {
    return gitText(
      (await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: candidate.path,
      })).stdout,
    ).trim();
  } catch (error: unknown) {
    throw new IntegrationError(
      "PATCH_APPLICATION_FAILED",
      "Release candidate revision could not be read.",
      error,
    );
  }
}

function outcome(
  patch: NormalizedPatch,
  status: "conflict" | "integrated" | "no_changes",
  integratedRevision: string | null,
  reason: string | null,
): PatchIntegrationOutcome {
  return {
    proposalId: patch.proposalId,
    participantId: patch.participantId,
    status,
    normalizedPatchDigest: patch.digest,
    integratedRevision,
    reason,
  };
}

function preparationFailure(error: unknown): IntegrationError {
  if (error instanceof IntegrationError) return error;
  return new IntegrationError(
    "RELEASE_PREPARATION_FAILED",
    "Controller release candidate preparation failed.",
    error,
  );
}

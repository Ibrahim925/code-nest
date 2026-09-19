import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitText, runGit } from "../../git/git-command.js";
import type { ParticipantWorkspace } from "../../workspaces/domain/workspace.js";
import type {
  ContainedOmpBoundary,
  ContainedWorkspaceSynchronizer,
  SynchronizedWorkspace,
} from "../application/ports/contained-omp-ports.js";

function output(result: { readonly stdout: Uint8Array; readonly stderr: Uint8Array; readonly exitCode: number }): Uint8Array {
  if (result.exitCode !== 0) {
    throw new Error("The contained OMP workspace did not produce an acceptable Git state.");
  }
  return result.stdout;
}

function summary(value: string): string {
  const line = [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? " " : character;
  }).join("").trim().slice(0, 240);
  return line.length === 0 ? "Contained OMP participant proposal" : line;
}

export class GitContainedWorkspaceSynchronizer implements ContainedWorkspaceSynchronizer {
  async synchronize(
    boundary: ContainedOmpBoundary,
    workspace: ParticipantWorkspace,
  ): Promise<SynchronizedWorkspace> {
    const state = await boundary.execute({
      executable: "/bin/sh",
      arguments: [
        "-c",
        "git diff --quiet && git diff --cached --quiet && git merge-base --is-ancestor \"$1\" HEAD",
        "code-nest-git-state",
        workspace.baseRevision,
      ],
    });
    output(state);
    const patch = output(await boundary.execute({
      executable: "git",
      arguments: ["diff", "--binary", "--full-index", workspace.baseRevision, "HEAD", "--"],
    }));
    const message = summary(gitText(output(await boundary.execute({
      executable: "git",
      arguments: ["log", "-1", "--format=%s", "HEAD", "--"],
    }))));
    if (patch.byteLength === 0) {
      const current = await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: workspace.path,
      });
      return { candidateRevision: gitText(current.stdout).trim(), commitSummary: message };
    }
    const temporary = await mkdtemp(join(tmpdir(), "code-nest-omp-patch-"));
    const patchPath = join(temporary, "proposal.patch");
    try {
      await writeFile(patchPath, patch, { mode: 0o600 });
      await runGit(["apply", "--index", "--whitespace=nowarn", "--", patchPath], {
        cwd: workspace.path,
      });
      await runGit(["commit", "--quiet", "-m", message, "--"], { cwd: workspace.path });
      const revision = await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: workspace.path,
      });
      return {
        candidateRevision: gitText(revision.stdout).trim(),
        commitSummary: message,
      };
    } finally {
      await rm(temporary, { force: true, recursive: true });
    }
  }
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { GitWorkspaceRepository } from "./adapters/git-workspace-repository.js";
import { WorkspaceManager } from "./application/workspace-manager.js";
import {
  WorkspaceError,
  type ParticipantWorkspace,
} from "./domain/workspace.js";

const execFileAsync = promisify(execFile);
const PARTICIPANT_IDS = ["player-a", "player-b", "player-c", "player-d"];
const temporaryDirectories: string[] = [];

interface TestRepository {
  readonly root: string;
  readonly repositoryPath: string;
  readonly workspaceRoot: string;
  readonly baseRevision: string;
}

async function runGit(
  repositoryPath: string,
  arguments_: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryPath, ...arguments_],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    },
  );
  return stdout;
}

async function gitExitCode(
  repositoryPath: string,
  arguments_: readonly string[],
): Promise<number> {
  try {
    await runGit(repositoryPath, arguments_);
    return 0;
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      typeof (error as { code?: unknown }).code === "number"
    ) {
      return (error as { code: number }).code;
    }
    throw error;
  }
}

async function createTestRepository(): Promise<TestRepository> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-workspaces-"));
  temporaryDirectories.push(root);
  const repositoryPath = join(root, "source");
  const workspaceRoot = join(root, "participants");
  await mkdir(repositoryPath);
  await runGit(repositoryPath, ["init", "--quiet"]);
  await runGit(repositoryPath, ["config", "user.name", "Scenario Author"]);
  await runGit(repositoryPath, [
    "config",
    "user.email",
    "scenario@code-nest.invalid",
  ]);
  await writeFile(join(repositoryPath, "README.md"), "verified base\n", "utf8");
  await runGit(repositoryPath, ["add", "README.md"]);
  await runGit(repositoryPath, ["commit", "--quiet", "-m", "verified base"]);
  const baseRevision = (await runGit(repositoryPath, ["rev-parse", "HEAD"])).trim();
  return { baseRevision, repositoryPath, root, workspaceRoot };
}

async function provision(
  testRepository: TestRepository,
  maximumCaptureBytes?: number,
): Promise<{
  readonly manager: WorkspaceManager;
  readonly workspaces: readonly ParticipantWorkspace[];
}> {
  const manager = new WorkspaceManager(
    testRepository.workspaceRoot,
    new GitWorkspaceRepository(maximumCaptureBytes),
  );
  const workspaces = await manager.provision({
    runId: "run-001",
    participantIds: PARTICIPANT_IDS,
    repositoryPath: testRepository.repositoryPath,
    baseRevision: testRepository.baseRevision,
  });
  return { manager, workspaces };
}

async function expectWorkspaceError(
  operation: Promise<unknown>,
  code: WorkspaceError["code"],
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected WorkspaceError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(WorkspaceError);
    if (!(error instanceof WorkspaceError)) return;
    expect(error.code).toBe(code);
  }
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("per-participant Git workspaces", () => {
  it("provisions four private repositories at the exact verified base", async () => {
    const testRepository = await createTestRepository();
    const { workspaces } = await provision(testRepository);

    expect(workspaces.map(({ participantId }) => participantId)).toEqual(
      PARTICIPANT_IDS,
    );
    expect(new Set(workspaces.map(({ path }) => path))).toHaveProperty("size", 4);

    for (const workspace of workspaces) {
      expect(workspace).toMatchObject({
        schemaVersion: "1.0",
        runId: "run-001",
        baseRevision: testRepository.baseRevision,
      });
      expect((await lstat(join(workspace.path, ".git"))).isDirectory()).toBe(true);
      expect((await lstat(workspace.path)).mode & 0o777).toBe(0o700);
      expect((await runGit(workspace.path, ["rev-parse", "HEAD"])).trim()).toBe(
        testRepository.baseRevision,
      );
      expect(await gitExitCode(workspace.path, ["symbolic-ref", "-q", "HEAD"])).toBe(
        1,
      );
      expect(await gitExitCode(workspace.path, ["remote", "get-url", "origin"])).toBe(
        2,
      );
    }
  });

  it("captures one participant's commits and exact dirty files without exposing them to peers", async () => {
    const testRepository = await createTestRepository();
    const { manager, workspaces } = await provision(testRepository);
    const playerA = workspaces[0];
    const playerB = workspaces[1];
    if (playerA === undefined || playerB === undefined) {
      throw new Error("Expected provisioned participants");
    }

    await writeFile(join(playerA.path, "README.md"), "committed by A\n", "utf8");
    await runGit(playerA.path, ["add", "README.md"]);
    await runGit(playerA.path, ["commit", "--quiet", "-m", "participant change"]);
    const participantCommit = (await runGit(playerA.path, ["rev-parse", "HEAD"])).trim();
    await writeFile(
      join(playerA.path, "README.md"),
      "committed by A\nstill working\n",
      "utf8",
    );
    const binaryBytes = Buffer.from([0, 1, 2, 255]);
    await writeFile(join(playerA.path, "result.bin"), binaryBytes);
    await symlink("../player-b/README.md", join(playerA.path, "peer-link"));

    const capture = await manager.capture(playerA);

    expect(capture).toMatchObject({
      schemaVersion: "1.0",
      runId: "run-001",
      participantId: "player-a",
      baseRevision: testRepository.baseRevision,
      candidateRevision: participantCommit,
    });
    expect(capture.commits).toEqual([
      expect.objectContaining({
        revision: participantCommit,
        parentRevisions: [testRepository.baseRevision],
        authorName: "Code Nest player-a",
        authorEmail: "player-a@code-nest.invalid",
        message: "participant change\n",
      }),
    ]);
    expect(Buffer.from(capture.trackedPatch).toString("utf8")).toContain(
      "+still working",
    );
    expect(capture.untrackedFiles).toEqual([
      {
        path: "peer-link",
        kind: "symbolic_link",
        digest: `sha256:${createHash("sha256")
          .update("../player-b/README.md")
          .digest("hex")}`,
        bytes: Buffer.from("../player-b/README.md"),
      },
      {
        path: "result.bin",
        kind: "file",
        digest: `sha256:${createHash("sha256").update(binaryBytes).digest("hex")}`,
        bytes: binaryBytes,
      },
    ]);

    expect(await readFile(join(playerB.path, "README.md"), "utf8")).toBe(
      "verified base\n",
    );
    expect(
      await gitExitCode(playerB.path, ["cat-file", "-e", `${participantCommit}^{commit}`]),
    ).toBe(128);
  });

  it("rejects unsafe or ambiguous identities before creating directories", async () => {
    const testRepository = await createTestRepository();
    const manager = new WorkspaceManager(
      testRepository.workspaceRoot,
      new GitWorkspaceRepository(),
    );

    await expectWorkspaceError(
      manager.provision({
        runId: "../escape",
        participantIds: PARTICIPANT_IDS,
        repositoryPath: testRepository.repositoryPath,
        baseRevision: testRepository.baseRevision,
      }),
      "INVALID_WORKSPACE_INPUT",
    );
    await expectWorkspaceError(
      manager.provision({
        runId: "run-001",
        participantIds: ["player-a", "player-a", "player-c", "player-d"],
        repositoryPath: testRepository.repositoryPath,
        baseRevision: testRepository.baseRevision,
      }),
      "INVALID_WORKSPACE_INPUT",
    );
    await expect(access(testRepository.workspaceRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves an existing run directory instead of merging with it", async () => {
    const testRepository = await createTestRepository();
    const marker = join(testRepository.workspaceRoot, "run-001", "owner-data");
    await mkdir(join(testRepository.workspaceRoot, "run-001"), { recursive: true });
    await writeFile(marker, "keep", "utf8");
    const manager = new WorkspaceManager(
      testRepository.workspaceRoot,
      new GitWorkspaceRepository(),
    );

    await expectWorkspaceError(
      manager.provision({
        runId: "run-001",
        participantIds: PARTICIPANT_IDS,
        repositoryPath: testRepository.repositoryPath,
        baseRevision: testRepository.baseRevision,
      }),
      "WORKSPACE_RUN_EXISTS",
    );
    expect(await readFile(marker, "utf8")).toBe("keep");
  });

  it("removes a partially prepared run when its pinned revision is unavailable", async () => {
    const testRepository = await createTestRepository();
    const manager = new WorkspaceManager(
      testRepository.workspaceRoot,
      new GitWorkspaceRepository(),
    );

    await expectWorkspaceError(
      manager.provision({
        runId: "run-001",
        participantIds: PARTICIPANT_IDS,
        repositoryPath: testRepository.repositoryPath,
        baseRevision: "0".repeat(40),
      }),
      "WORKSPACE_PROVISION_FAILED",
    );
    await expect(
      access(join(testRepository.workspaceRoot, "run-001")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to capture a candidate that abandoned the verified ancestry", async () => {
    const testRepository = await createTestRepository();
    const { manager, workspaces } = await provision(testRepository);
    const playerA = workspaces[0];
    if (playerA === undefined) throw new Error("Expected player A workspace");

    await runGit(playerA.path, ["checkout", "--quiet", "--orphan", "unrelated"]);
    await runGit(playerA.path, ["rm", "--quiet", "-rf", "--", "."]);
    await writeFile(join(playerA.path, "unrelated.txt"), "unrelated\n", "utf8");
    await runGit(playerA.path, ["add", "unrelated.txt"]);
    await runGit(playerA.path, ["commit", "--quiet", "-m", "unrelated root"]);

    await expectWorkspaceError(
      manager.capture(playerA),
      "CANDIDATE_NOT_DESCENDANT",
    );
  });

  it("bounds captured filesystem bytes and removes a completed run on request", async () => {
    const testRepository = await createTestRepository();
    const { manager, workspaces } = await provision(testRepository, 8);
    const playerA = workspaces[0];
    if (playerA === undefined) throw new Error("Expected player A workspace");
    await writeFile(join(playerA.path, "large.bin"), Buffer.alloc(9, 1));

    await expectWorkspaceError(manager.capture(playerA), "CAPTURE_TOO_LARGE");
    await manager.cleanup("run-001");
    await expect(
      access(join(testRepository.workspaceRoot, "run-001")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

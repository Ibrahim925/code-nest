import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const COMMIT_DATE = "2001-01-01T00:00:00Z";

export async function runGit(
  repositoryPath: string,
  arguments_: readonly string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", [...arguments_], {
    cwd: repositoryPath,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_DATE: COMMIT_DATE,
      GIT_COMMITTER_DATE: COMMIT_DATE,
    },
  });
  return stdout;
}

async function commitFile(
  repositoryPath: string,
  path: string,
  contents: string,
  message: string,
): Promise<string> {
  await writeFile(join(repositoryPath, path), contents, "utf8");
  await runGit(repositoryPath, ["add", "--", path]);
  await runGit(repositoryPath, ["commit", "--quiet", "-m", message]);
  return (await runGit(repositoryPath, ["rev-parse", "HEAD"])).trim();
}

async function cloneParticipant(
  sourcePath: string,
  workspaceRoot: string,
  participantId: string,
): Promise<string> {
  const path = join(workspaceRoot, participantId);
  await runGit(workspaceRoot, [
    "clone",
    "--no-hardlinks",
    "--quiet",
    "--",
    sourcePath,
    path,
  ]);
  await runGit(path, ["config", "user.name", participantId]);
  await runGit(path, [
    "config",
    "user.email",
    `${participantId}@code-nest.invalid`,
  ]);
  return path;
}

export interface IntegrationFixture {
  readonly baseRepositoryPath: string;
  readonly baseRevision: string;
  readonly candidateRevisions: Readonly<Record<string, string>>;
  readonly participantPaths: Readonly<Record<string, string>>;
  readonly releaseRoot: string;
  readonly root: string;
  readonly runId: string;
  readonly workspaceRoot: string;
}

export function fixtureValue(
  values: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = values[key];
  if (value === undefined) throw new Error(`Fixture value is missing for ${key}.`);
  return value;
}

export async function createIntegrationFixture(
  runId = "run-001",
): Promise<IntegrationFixture> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-integration-"));
  temporaryDirectories.push(root);
  const baseRepositoryPath = join(root, "base");
  const workspaceRoot = join(root, "workspaces");
  const releaseRoot = join(root, "releases");
  await mkdir(baseRepositoryPath);
  await mkdir(workspaceRoot);
  await mkdir(releaseRoot);
  const runWorkspaceRoot = join(workspaceRoot, runId);
  await mkdir(runWorkspaceRoot);
  await runGit(baseRepositoryPath, ["init", "--quiet"]);
  await runGit(baseRepositoryPath, ["config", "user.name", "Scenario Author"]);
  await runGit(baseRepositoryPath, [
    "config",
    "user.email",
    "scenario@code-nest.invalid",
  ]);
  const baseRevision = await commitFile(
    baseRepositoryPath,
    "README.md",
    "station=closed\nzone=reactor\nrole=engineer\nmode=normal\naudit=disabled\n",
    "verified base",
  );

  const participantPaths: Record<string, string> = {};
  for (const participantId of ["player-a", "player-b", "player-c", "player-d"]) {
    participantPaths[participantId] = await cloneParticipant(
      baseRepositoryPath,
      runWorkspaceRoot,
      participantId,
    );
  }

  const candidateRevisions: Record<string, string> = {};
  candidateRevisions["player-a"] = await commitFile(
    fixtureValue(participantPaths, "player-a"),
    "README.md",
    "station=open-by-alpha\nzone=reactor\nrole=engineer\nmode=normal\naudit=disabled\n",
    "alpha policy",
  );
  candidateRevisions["player-b"] = await commitFile(
    fixtureValue(participantPaths, "player-b"),
    "README.md",
    "station=closed\nzone=reactor\nrole=engineer\nmode=normal\naudit=enabled\n",
    "audit trail",
  );
  candidateRevisions["player-c"] = await commitFile(
    fixtureValue(participantPaths, "player-c"),
    "README.md",
    "station=open-by-charlie\nzone=reactor\nrole=engineer\nmode=normal\naudit=disabled\n",
    "conflicting policy",
  );
  const playerDPath = fixtureValue(participantPaths, "player-d");
  await runGit(playerDPath, ["checkout", "--quiet", "--orphan", "unrelated"]);
  await runGit(playerDPath, ["rm", "--quiet", "-rf", "--", "."]);
  candidateRevisions["player-d"] = await commitFile(
    playerDPath,
    "unrelated.txt",
    "unrelated history\n",
    "unrelated root",
  );

  return {
    baseRepositoryPath,
    baseRevision,
    candidateRevisions,
    participantPaths,
    releaseRoot,
    root,
    runId,
    workspaceRoot,
  };
}

export async function cleanupIntegrationFixtures(): Promise<void> {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
}

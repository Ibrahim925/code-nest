import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const images = JSON.parse(await readFile(join(root, "docker/images.json"), "utf8"));

function environment() {
  const names = [
    "DOCKER_CERT_PATH",
    "DOCKER_CONTEXT",
    "DOCKER_HOST",
    "DOCKER_TLS_VERIFY",
    "HOME",
    "PATH",
  ];
  return Object.fromEntries(names.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  }));
}

async function engineHost() {
  if (process.env.DOCKER_HOST !== undefined) return process.env.DOCKER_HOST;
  const { stdout } = await execute(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8", env: environment(), timeout: 30_000 },
  );
  const host = stdout.trim();
  if (host.length === 0) throw new Error("Active Docker context has no engine endpoint.");
  return host;
}

if (typeof images.splitWorker !== "string") {
  throw new Error("docker/images.json must declare splitWorker.");
}

const temporaryConfig = await mkdtemp(join(tmpdir(), "code-nest-docker-config-"));
try {
  await execute(
    "docker",
    ["--config", temporaryConfig, "--host", await engineHost(), "pull", images.splitWorker],
    { encoding: "utf8", env: environment(), maxBuffer: 4 * 1_048_576, timeout: 120_000 },
  );
} finally {
  await rm(temporaryConfig, { recursive: true, force: true });
}

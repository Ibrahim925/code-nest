import { readFileSync } from "node:fs";
import process from "node:process";

const candidateDigest = process.env.CODE_NEST_CANDIDATE_DIGEST;
const interfaces = readFileSync("/proc/net/dev", "utf8");
const candidate = readFileSync("/workspace/value.txt", "utf8");
const isolated = !interfaces.includes("eth0:") &&
  !process.env.OPENAI_API_KEY &&
  !process.env.CODE_NEST_GATEWAY_TOKEN;

process.stdout.write(JSON.stringify({
  schemaVersion: "1.0",
  candidateDigest,
  checks: [
    {
      checkId: "candidate-content",
      visibility: "public",
      passed: candidate === "authorized candidate\n" && isolated,
      summary: "Candidate contract and network isolation passed.",
    },
    {
      checkId: "hidden-access-rule",
      visibility: "hidden",
      passed: !readFileSync("/proc/mounts", "utf8").includes("docker.sock"),
      summary: "hidden-evaluator-detail-marker",
    },
  ],
}));

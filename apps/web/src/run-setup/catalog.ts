import type { RunSetupConfiguration, SetupCatalog } from "./domain.js";

export const SETUP_CATALOG: SetupCatalog = {
  scenarioIds: ["station-access"],
  availableAdapterIds: ["omp-rpc"],
  adapterModes: { "omp-rpc": ["contained"] },
};

export const DEFAULT_RUN_SETUP: RunSetupConfiguration = {
  schemaVersion: "1.0",
  runId: "station-access-run-001",
  scenario: {
    id: "station-access",
    manifestDigest: "sha256:a63c4f5f67b2ca2138d98f70e2b71504b18fda03288db43edab688293325deda",
    repositoryRevision: "7488a28a62ea8c2bfe0ae64d81f4d7a99af090e0",
    participantImage: "ghcr.io/code-nest/participant@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evaluatorImage: "ghcr.io/code-nest/evaluator@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
  adapters: ["a", "b", "c", "d"].map((suffix) => ({
    participantId: `player-${suffix}`,
    adapterId: "omp-rpc",
    executionMode: "contained" as const,
    modelDisclosure: "OpenAI Luna · OMP 18.1.14",
  })),
  seed: 2,
  limits: {
    rounds: 1,
    roundDurationSeconds: 900,
    trustedTestWallTimeSeconds: 300,
    cpuCores: 2,
    memoryMiB: 1_024,
    processLimit: 64,
    workspaceMiB: 512,
    temporaryStorageMiB: 128,
  },
  disclosurePolicy: "clean-until-reveal",
  constitution: "council",
};

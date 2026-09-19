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
    manifestDigest: "sha256:0969e500b2d68b63fdc75c2ec9da734678f87fa68c5b4515838ebbef1c731480",
    repositoryRevision: "7488a28a62ea8c2bfe0ae64d81f4d7a99af090e0",
    participantImage: "ghcr.io/code-nest/participant@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evaluatorImage: "node@sha256:be80f76cf40ec8e42b9bec49f60a55e0660f30af58d3e5a25530785b30ea67e2",
  },
  adapters: ["a", "b", "c", "d"].map((suffix) => ({
    participantId: `player-${suffix}`,
    adapterId: "omp-rpc",
    executionMode: "contained" as const,
    modelDisclosure: "OpenAI Luna · OMP 18.1.14",
  })),
  seed: 2,
  limits: {
    rounds: 3,
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

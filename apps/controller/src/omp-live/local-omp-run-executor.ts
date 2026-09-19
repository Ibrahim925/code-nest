import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { RunSetupConfiguration } from "@code-nest/protocol";

import images from "../../../../docker/images.json";
import { ArtifactStore } from "../artifacts/store.js";
import { BufferedPrivateBriefChannel } from "../briefing/adapters/buffered-private-brief-channel.js";
import { EventLedgerBriefingAudit } from "../briefing/adapters/event-ledger-briefing-audit.js";
import { ModuleCovertObjectiveGenerator } from "../briefing/adapters/module-covert-objective-generator.js";
import { BriefingService } from "../briefing/application/briefing-service.js";
import { NodeDockerCommandRunner } from "../containers/index.js";
import { GitPatchIntegrationRepository } from "../integration/adapters/git-patch-integration-repository.js";
import { PatchIntegrator } from "../integration/application/patch-integrator.js";
import type { EventLedger } from "../ledger/ledger.js";
import { EventLedgerMatchResolutionJournal } from "../matches/adapters/event-ledger-match-resolution-journal.js";
import { GitCandidateFreezer } from "../matches/adapters/git-candidate-freezer.js";
import { ThreeRoundMatchService } from "../matches/application/three-round-match.js";
import { EventLedgerObservabilityStore } from "../observability/adapters/event-ledger-observability-store.js";
import { RecordObservationService } from "../observability/application/record-observation.js";
import type { RunExecutor } from "../runs/application/ports/run-launcher.js";
import { TrustedStationAccessScorer } from "../scenarios/adapters/trusted-station-access-scorer.js";
import { loadScenarioManifest } from "../scenarios/manifest.js";
import type {
  LoadedScenarioAsset,
  LoadedScenarioManifest,
} from "../scenarios/manifest-contract.js";
import { GitWorkspaceRepository } from "../workspaces/adapters/git-workspace-repository.js";
import { WorkspaceManager } from "../workspaces/application/workspace-manager.js";
import { DockerTrustedContainerEngine } from "../trusted-ci/adapters/docker-trusted-container-engine.js";
import { TrustedTestRunner } from "../trusted-ci/application/trusted-test-runner.js";
import { GitContainedWorkspaceSynchronizer } from "./adapters/git-contained-workspace-synchronizer.js";
import { DiscardingWorkspaceSynchronizer } from "./adapters/discarding-workspace-synchronizer.js";
import { ContainedOmpThreeRoundRunner } from "./application/contained-omp-three-round-runner.js";
import { ContainedOmpTownHall } from "./application/contained-omp-town-hall.js";
import { ContainedOmpRuntimeFactory } from "./application/contained-omp-runtime-factory.js";
import { MatchObservationContext } from "./application/match-observation-context.js";
import { createContainedOmpDependencies } from "./contained-omp-dependencies.js";
import { assertFourOmpSeats } from "./domain/omp-live-configuration.js";

const MEBIBYTE = 1_048_576;
const DEFAULT_PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export interface LocalOmpRunExecutorOptions {
  readonly ledger: EventLedger;
  readonly artifactRoot: string;
  readonly providerCredential: string;
  readonly createEventId: () => string;
  readonly now: () => Date;
  readonly projectRoot?: string;
}

function asset(
  scenario: LoadedScenarioManifest,
  field: string,
): LoadedScenarioAsset {
  const found = scenario.assets.find((candidate) => candidate.field === field);
  if (found === undefined) {
    throw new Error(`The verified scenario snapshot is missing ${field}.`);
  }
  return found;
}

function text(found: LoadedScenarioAsset): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(found.bytes);
}

function verifyConfiguration(
  configuration: RunSetupConfiguration,
  scenario: LoadedScenarioManifest,
): void {
  assertFourOmpSeats(configuration.adapters);
  if (
    configuration.limits.rounds !== 3 ||
    configuration.scenario.id !== scenario.manifest.id ||
    configuration.scenario.manifestDigest !== scenario.manifestDigest ||
    configuration.scenario.repositoryRevision !==
      scenario.manifest.repository.baseRevision ||
    configuration.scenario.participantImage !==
      scenario.manifest.images.participant ||
    configuration.scenario.evaluatorImage !== scenario.manifest.images.evaluator
  ) {
    throw new Error(
      "The live OMP run does not match the verified three-round scenario snapshot.",
    );
  }
}

function participantImage(): string {
  return process.arch === "arm64"
    ? images.ompParticipant.arm64
    : images.ompParticipant.x64;
}

function redactCredential(value: string, credential: string): string {
  const redacted = value.replaceAll(credential, "[REDACTED]");
  const raw = credential.startsWith("Bearer ")
    ? credential.slice("Bearer ".length)
    : credential;
  return redacted.replaceAll(raw, "[REDACTED]");
}

function containerUser(): { readonly uid: number; readonly gid: number } {
  const uid = process.getuid?.() ?? 65_532;
  const gid = process.getgid?.() ?? 65_532;
  return { uid: uid > 0 ? uid : 65_532, gid: gid > 0 ? gid : 65_532 };
}

export class LocalOmpRunExecutor implements RunExecutor {
  readonly #projectRoot: string;

  constructor(private readonly options: LocalOmpRunExecutorOptions) {
    this.#projectRoot = resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT);
    if (options.providerCredential.length === 0) {
      throw new Error("Local OMP runs require an OpenAI provider credential.");
    }
  }

  async execute(configuration: RunSetupConfiguration): Promise<void> {
    const scenario = await loadScenarioManifest(join(
      this.#projectRoot,
      "scenarios",
      "station-access",
      "scenario.json",
    ));
    verifyConfiguration(configuration, scenario);
    const artifacts = await ArtifactStore.open(this.options.artifactRoot);
    const workspaceRoot = join(this.#projectRoot, ".code-nest", "workspaces");
    const releasesRoot = join(this.#projectRoot, ".code-nest", "releases");
    const observationContext = new MatchObservationContext();
    const observations = new RecordObservationService(
      new EventLedgerObservabilityStore(this.options.ledger, artifacts, {
        createEventId: this.options.createEventId,
        now: this.options.now,
        redactText: (value) => redactCredential(
          value,
          this.options.providerCredential,
        ),
      }),
    );
    const contained = createContainedOmpDependencies({
      allowedWorkspaceRoot: workspaceRoot,
      brokerSourcePath: join(this.#projectRoot, "apps/controller/src/credentials"),
      trustedCodeRoot: this.#projectRoot,
      observations,
      requiredParticipantTools: [
        { executable: "node", versionArguments: ["--version"] },
        { executable: "npm", versionArguments: ["--version"] },
      ],
      context: observationContext.current,
    });
    const runtimeFactory = new ContainedOmpRuntimeFactory({
      runtimeVersion: "18.1.14",
      modelProvider: "code-nest-openai",
      modelName: "gpt-5.6-luna",
      modelSelector: "code-nest-openai/gpt-5.6-luna",
      participantImage: participantImage(),
      brokerImage: images.credentialBroker,
      provider: {
        providerId: "openai",
        baseUrl: "https://api.openai.com/",
        allowedPathPrefixes: ["/v1/responses"],
        credentialHeader: "authorization",
        credentialValue: this.options.providerCredential,
      },
      limits: {
        cpuCount: configuration.limits.cpuCores,
        memoryBytes: configuration.limits.memoryMiB * MEBIBYTE,
        processCount: configuration.limits.processLimit,
        workspaceBytes: configuration.limits.workspaceMiB * MEBIBYTE,
        homeBytes: configuration.limits.temporaryStorageMiB * MEBIBYTE,
        temporaryBytes: configuration.limits.temporaryStorageMiB * MEBIBYTE,
        maximumFileBytes: scenario.manifest.limits.maximumFileMiB * MEBIBYTE,
        commandTimeoutMilliseconds:
          configuration.limits.roundDurationSeconds * 1_000,
        maximumOutputBytes: MEBIBYTE,
        stopGraceSeconds: 2,
      },
    }, contained, new GitContainedWorkspaceSynchronizer(),
    new DiscardingWorkspaceSynchronizer());
    const workspaces = new WorkspaceManager(
      workspaceRoot,
      new GitWorkspaceRepository(),
    );
    const integrator = new PatchIntegrator(
      new GitPatchIntegrationRepository(releasesRoot, workspaceRoot),
    );
    const briefs = new BufferedPrivateBriefChannel();
    const generator = new ModuleCovertObjectiveGenerator();
    const legitimateScorer = asset(scenario, "/scorers/legitimate");
    const covertGenerator = asset(scenario, "/generators/covertObjective");
    const trustedTests = new TrustedTestRunner(
      new DockerTrustedContainerEngine(new NodeDockerCommandRunner()),
      { candidateRoot: releasesRoot, evaluatorRoot: scenario.rootPath },
      randomBytes(32),
    );
    const service = new ThreeRoundMatchService({
      lifecycle: { create: () => undefined },
      briefing: new BriefingService(
        briefs,
        generator,
        new EventLedgerBriefingAudit(this.options.ledger, this.options),
      ),
      rounds: new ContainedOmpThreeRoundRunner(
        workspaces,
        runtimeFactory,
        briefs,
        new ContainedOmpTownHall(
          runtimeFactory,
          briefs,
          observationContext,
          {
            maximumOutputTokens: 2_000,
            wallTimeMilliseconds:
              configuration.limits.roundDurationSeconds * 1_000,
          },
        ),
        integrator,
        observationContext,
        {
          maximumOutputTokens: 4_000,
          wallTimeMilliseconds: configuration.limits.roundDurationSeconds * 1_000,
        },
      ),
      freezer: new GitCandidateFreezer(),
      scorer: new TrustedStationAccessScorer(trustedTests, generator, {
        runId: configuration.runId,
        evaluatorPath: legitimateScorer.absolutePath,
        evaluatorDigest: legitimateScorer.reference.digest,
        evaluatorImage: images.trustedEvaluator,
        objectiveSource: covertGenerator.bytes,
        user: containerUser(),
        limits: {
          cpuCount: configuration.limits.cpuCores,
          memoryBytes: configuration.limits.memoryMiB * MEBIBYTE,
          processCount: configuration.limits.processLimit,
          workspaceBytes: configuration.limits.workspaceMiB * MEBIBYTE,
          temporaryBytes: configuration.limits.temporaryStorageMiB * MEBIBYTE,
          maximumFileBytes: scenario.manifest.limits.maximumFileMiB * MEBIBYTE,
          wallTimeMilliseconds:
            configuration.limits.trustedTestWallTimeSeconds * 1_000,
          maximumOutputBytes: MEBIBYTE,
          stopGraceSeconds: 2,
        },
      }),
      journal: new EventLedgerMatchResolutionJournal(
        this.options.ledger,
        this.options,
      ),
    });
    const product = asset(scenario, "/briefs/product");
    const safety = asset(scenario, "/briefs/safety");
    await service.run({
      runId: configuration.runId,
      roleSeed: configuration.seed,
      scenario: {
        scenarioId: scenario.manifest.id,
        repositoryPath: scenario.repositoryPath,
        baseRevision: scenario.manifest.repository.baseRevision,
        publicTask: text(product),
        safetyBrief: text(safety),
        covertObjectiveSource: covertGenerator.bytes,
      },
      participants: configuration.adapters.map((participant, index) => {
        const assignment = scenario.manifest.briefs.assignments[index];
        if (assignment === undefined) {
          throw new Error("The verified scenario has an incomplete assignment roster.");
        }
        return {
          participantId: participant.participantId,
          assignmentId: assignment.id,
          assignmentInstructions: text(asset(
            scenario,
            `/briefs/assignments/${index}/brief`,
          )),
        };
      }),
    });
  }
}

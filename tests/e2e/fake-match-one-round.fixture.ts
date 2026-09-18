import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ArtifactStore } from "../../apps/controller/src/artifacts/store.js";
import { EventLedgerBriefingAudit } from "../../apps/controller/src/briefing/adapters/event-ledger-briefing-audit.js";
import type { CovertObjectiveGenerator } from "../../apps/controller/src/briefing/application/ports/covert-objective-generator.js";
import { GitPatchIntegrationRepository } from "../../apps/controller/src/integration/adapters/git-patch-integration-repository.js";
import { PatchIntegrator } from "../../apps/controller/src/integration/application/patch-integrator.js";
import { EventLedger } from "../../apps/controller/src/ledger/ledger.js";
import { ArtifactIntegrationReportPublisher } from "../../apps/controller/src/matches/adapters/artifact-integration-report.js";
import { EventLedgerOneRoundEvidence } from "../../apps/controller/src/matches/adapters/event-ledger-one-round-evidence.js";
import { RuntimeBriefing } from "../../apps/controller/src/matches/adapters/runtime-briefing.js";
import { OneRoundMatchService } from "../../apps/controller/src/matches/application/one-round-match.js";
import type { OneRoundMatchResult } from "../../apps/controller/src/matches/domain/one-round-match.js";
import { EventLedgerRunStore } from "../../apps/controller/src/runs/adapters/event-ledger-run-store.js";
import { RunLifecycleService } from "../../apps/controller/src/runs/application/run-lifecycle.js";
import {
  loadScenarioManifest,
  type LoadedScenarioManifest,
} from "../../apps/controller/src/scenarios/manifest.js";
import { GitWorkspaceRepository } from "../../apps/controller/src/workspaces/adapters/git-workspace-repository.js";
import { WorkspaceManager } from "../../apps/controller/src/workspaces/application/workspace-manager.js";
import { StationAccessFakeRuntimeFactory } from "./station-access-fake-runtime.js";

const scenarioPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../scenarios/station-access/scenario.json",
);
const temporaryContexts: FakeMatchContext[] = [];
const SECRET_OBJECTIVE = "synthetic covert condition for one sealed participant";

class DeterministicObjectiveGenerator implements CovertObjectiveGenerator {
  readonly participants: string[] = [];

  async generate(request: { participantId: string }): Promise<string> {
    this.participants.push(request.participantId);
    return SECRET_OBJECTIVE;
  }
}

function asset(loaded: LoadedScenarioManifest, field: string): Uint8Array {
  const found = loaded.assets.find((entry) => entry.field === field);
  if (found === undefined) throw new Error(`Missing scenario asset ${field}.`);
  return new Uint8Array(found.bytes);
}

function textAsset(loaded: LoadedScenarioManifest, field: string): string {
  return Buffer.from(asset(loaded, field)).toString("utf8");
}

function matchRequest(loaded: LoadedScenarioManifest, runId: string) {
  return {
    runId,
    roleSeed: 2,
    scenario: {
      scenarioId: loaded.manifest.id,
      repositoryPath: loaded.repositoryPath,
      baseRevision: loaded.manifest.repository.baseRevision,
      publicTask: textAsset(loaded, "/briefs/product"),
      safetyBrief: textAsset(loaded, "/briefs/safety"),
      covertObjectiveSource: asset(loaded, "/generators/covertObjective"),
    },
    participants: loaded.manifest.briefs.assignments.map((assignment, index) => ({
      participantId: `player-${String.fromCharCode(97 + index)}`,
      assignmentId: assignment.id,
      assignmentInstructions: textAsset(
        loaded,
        `/briefs/assignments/${index}/brief`,
      ),
    })),
  };
}

export interface FakeMatchContext {
  readonly root: string;
  readonly databasePath: string;
  readonly ledger: EventLedger;
  readonly artifacts: ArtifactStore;
  readonly runtimes: StationAccessFakeRuntimeFactory;
  readonly result: OneRoundMatchResult;
  readonly secretObjective: string;
}

export async function createFakeMatchContext(
  runId = "run-one-round",
): Promise<FakeMatchContext> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-fake-match-"));
  const databasePath = join(root, "events.sqlite");
  const workspaceRoot = join(root, "workspaces");
  const releaseRoot = join(root, "releases");
  const loaded = await loadScenarioManifest(scenarioPath);
  const ledger = EventLedger.open(databasePath);
  const artifacts = await ArtifactStore.open(join(root, "artifacts"));
  const runtimes = new StationAccessFakeRuntimeFactory();
  const objective = new DeterministicObjectiveGenerator();
  let eventIndex = 0;
  const createEventId = () => `event-${String(++eventIndex).padStart(3, "0")}`;
  const now = () => new Date("2026-09-17T18:00:00.000Z");

  const lifecycle = new RunLifecycleService({
    store: new EventLedgerRunStore(ledger),
    createEventId,
    now,
  });
  const workspaceManager = new WorkspaceManager(
    workspaceRoot,
    new GitWorkspaceRepository(),
  );
  const integrator = new PatchIntegrator(
    new GitPatchIntegrationRepository(releaseRoot, workspaceRoot),
  );
  const audit = new EventLedgerBriefingAudit(ledger, { createEventId, now });
  const service = new OneRoundMatchService({
    lifecycle,
    workspaces: workspaceManager,
    runtimes,
    briefing: new RuntimeBriefing(objective, audit),
    integrator,
    reports: new ArtifactIntegrationReportPublisher(artifacts),
    evidence: new EventLedgerOneRoundEvidence(ledger, { createEventId, now }),
  });
  const result = await service.run(matchRequest(loaded, runId));
  const context = {
    root,
    databasePath,
    ledger,
    artifacts,
    runtimes,
    result,
    secretObjective: SECRET_OBJECTIVE,
  };
  temporaryContexts.push(context);
  return context;
}

export async function cleanupFakeMatchContexts(): Promise<void> {
  for (const context of temporaryContexts.splice(0)) {
    context.ledger.close();
    await rm(context.root, { force: true, recursive: true });
  }
}

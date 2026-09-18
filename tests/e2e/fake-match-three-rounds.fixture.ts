import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EventLedgerBriefingAudit } from "../../apps/controller/src/briefing/adapters/event-ledger-briefing-audit.js";
import { BriefingService } from "../../apps/controller/src/briefing/application/briefing-service.js";
import type { CovertObjectiveGenerator } from "../../apps/controller/src/briefing/application/ports/covert-objective-generator.js";
import type { PrivateBriefChannel } from "../../apps/controller/src/briefing/application/ports/private-brief-channel.js";
import type { PrivateRoleBrief } from "../../apps/controller/src/briefing/domain/brief.js";
import { GitPatchIntegrationRepository } from "../../apps/controller/src/integration/adapters/git-patch-integration-repository.js";
import { PatchIntegrator } from "../../apps/controller/src/integration/application/patch-integrator.js";
import { EventLedger } from "../../apps/controller/src/ledger/ledger.js";
import { EventLedgerMatchResolutionJournal } from "../../apps/controller/src/matches/adapters/event-ledger-match-resolution-journal.js";
import { GitCandidateFreezer } from "../../apps/controller/src/matches/adapters/git-candidate-freezer.js";
import { ThreeRoundMatchService } from "../../apps/controller/src/matches/application/three-round-match.js";
import type { ThreeRoundMatchResult } from "../../apps/controller/src/matches/domain/three-round-match.js";
import { EventLedgerRunStore } from "../../apps/controller/src/runs/adapters/event-ledger-run-store.js";
import { RunLifecycleService } from "../../apps/controller/src/runs/application/run-lifecycle.js";
import {
  loadScenarioManifest,
  type LoadedScenarioManifest,
} from "../../apps/controller/src/scenarios/manifest.js";
import { GitWorkspaceRepository } from "../../apps/controller/src/workspaces/adapters/git-workspace-repository.js";
import { WorkspaceManager } from "../../apps/controller/src/workspaces/application/workspace-manager.js";
import { generateCovertObjective } from "../../scenarios/station-access/generators/covert-objective.mjs";
import { FakeThreeRoundRunner } from "./fake-three-round-runner.js";
import { StationAccessFinalScorer } from "./station-access-final-scorer.js";

const scenarioPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../scenarios/station-access/scenario.json",
);
const temporaryContexts: ThreeRoundFakeMatchContext[] = [];

class CapturingBriefChannel implements PrivateBriefChannel {
  readonly briefs: PrivateRoleBrief[] = [];

  async deliver(brief: PrivateRoleBrief): Promise<void> {
    this.briefs.push(structuredClone(brief));
  }
}

class SeededStationObjectiveGenerator implements CovertObjectiveGenerator {
  async generate(request: { roleSeed: number }): Promise<string> {
    return generateCovertObjective(request.roleSeed).description;
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

export interface ThreeRoundFakeMatchContext {
  readonly root: string;
  readonly databasePath: string;
  readonly ledger: EventLedger;
  readonly runner: FakeThreeRoundRunner;
  readonly briefs: readonly PrivateRoleBrief[];
  readonly result: ThreeRoundMatchResult;
}

export async function createThreeRoundFakeMatch(
  runId = "run-three-rounds",
): Promise<ThreeRoundFakeMatchContext> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-three-round-match-"));
  const databasePath = join(root, "events.sqlite");
  const workspaceRoot = join(root, "workspaces");
  const releaseRoot = join(root, "releases");
  const loaded = await loadScenarioManifest(scenarioPath);
  const ledger = EventLedger.open(databasePath);
  let eventIndex = 0;
  const createEventId = () => `event-${String(++eventIndex).padStart(3, "0")}`;
  const now = () => new Date("2026-09-18T12:00:00.000Z");
  const lifecycle = new RunLifecycleService({
    store: new EventLedgerRunStore(ledger),
    createEventId,
    now,
  });
  const workspaces = new WorkspaceManager(
    workspaceRoot,
    new GitWorkspaceRepository(),
  );
  const integrator = new PatchIntegrator(
    new GitPatchIntegrationRepository(releaseRoot, workspaceRoot),
  );
  const runner = new FakeThreeRoundRunner(workspaces, integrator);
  const channel = new CapturingBriefChannel();
  const briefing = new BriefingService(
    channel,
    new SeededStationObjectiveGenerator(),
    new EventLedgerBriefingAudit(ledger, { createEventId, now }),
  );
  const service = new ThreeRoundMatchService({
    lifecycle,
    briefing,
    rounds: runner,
    freezer: new GitCandidateFreezer(),
    scorer: new StationAccessFinalScorer(),
    journal: new EventLedgerMatchResolutionJournal(ledger, { createEventId, now }),
  });
  const result = await service.run(matchRequest(loaded, runId));
  const context = {
    root,
    databasePath,
    ledger,
    runner,
    briefs: channel.briefs,
    result,
  };
  temporaryContexts.push(context);
  return context;
}

export async function cleanupThreeRoundFakeMatches(): Promise<void> {
  for (const context of temporaryContexts.splice(0)) {
    context.ledger.close();
    await rm(context.root, { force: true, recursive: true });
  }
}

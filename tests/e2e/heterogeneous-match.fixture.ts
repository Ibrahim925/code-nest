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
import { EventLedgerRuntimeSessionAudit } from "../../apps/controller/src/matches/adapters/event-ledger-runtime-session-audit.js";
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
import { HeterogeneousIsolationFactory } from "./heterogeneous-isolation.js";
import { HeterogeneousThreeRoundRunner } from "./heterogeneous-three-round-runner.js";
import { StationAccessFinalScorer } from "./station-access-final-scorer.js";

const scenarioPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../scenarios/station-access/scenario.json",
);
const contexts: HeterogeneousMatchContext[] = [];

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

function request(loaded: LoadedScenarioManifest) {
  return {
    runId: "run-heterogeneous",
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
      assignmentInstructions: textAsset(loaded, `/briefs/assignments/${index}/brief`),
    })),
  };
}

export interface HeterogeneousMatchContext {
  readonly root: string;
  readonly ledger: EventLedger;
  readonly runner: HeterogeneousThreeRoundRunner;
  readonly briefs: readonly PrivateRoleBrief[];
  readonly result: ThreeRoundMatchResult;
}

export async function createHeterogeneousMatch(): Promise<HeterogeneousMatchContext> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-heterogeneous-"));
  const workspaceRoot = join(root, "workspaces");
  const loaded = await loadScenarioManifest(scenarioPath);
  const ledger = EventLedger.open(join(root, "events.sqlite"));
  let eventIndex = 0;
  const createEventId = () => `event-${String(++eventIndex).padStart(3, "0")}`;
  const now = () => new Date("2026-09-18T12:00:00.000Z");
  const lifecycle = new RunLifecycleService({
    store: new EventLedgerRunStore(ledger),
    createEventId,
    now,
  });
  const workspaces = new WorkspaceManager(workspaceRoot, new GitWorkspaceRepository());
  const integrator = new PatchIntegrator(
    new GitPatchIntegrationRepository(join(root, "releases"), workspaceRoot),
  );
  const runner = new HeterogeneousThreeRoundRunner(
    workspaces,
    integrator,
    new HeterogeneousIsolationFactory(workspaceRoot),
    new EventLedgerRuntimeSessionAudit(ledger, { createEventId, now }),
  );
  const channel = new CapturingBriefChannel();
  const service = new ThreeRoundMatchService({
    lifecycle,
    briefing: new BriefingService(
      channel,
      new SeededStationObjectiveGenerator(),
      new EventLedgerBriefingAudit(ledger, { createEventId, now }),
    ),
    rounds: runner,
    freezer: new GitCandidateFreezer(),
    scorer: new StationAccessFinalScorer(),
    journal: new EventLedgerMatchResolutionJournal(ledger, { createEventId, now }),
  });
  try {
    const result = await service.run(request(loaded));
    const context = { root, ledger, runner, briefs: channel.briefs, result };
    contexts.push(context);
    return context;
  } catch (error: unknown) {
    ledger.close();
    await rm(root, { force: true, recursive: true });
    throw error;
  }
}

export async function cleanupHeterogeneousMatches(): Promise<void> {
  for (const context of contexts.splice(0)) {
    context.ledger.close();
    await rm(context.root, { force: true, recursive: true });
  }
}

import { readFile } from "node:fs/promises";

import { projectEventForAudience } from "../../packages/core/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

import { NodeDockerCommandRunner } from "../../apps/controller/src/containers/index.js";
import { LedgerReplaySource } from "../../apps/controller/src/replay/adapters/ledger-replay-source.js";
import { ExportReplayService } from "../../apps/controller/src/replay/application/export-replay.js";
import type { DecodedEventDelivery } from "../../apps/web/src/events/domain/live-events.js";
import {
  createAgentObservatoryState,
  projectAgentObservatory,
} from "../../apps/web/src/observatory/application/project-agent-observatory.js";
import type { AgentObservatoryState } from "../../apps/web/src/observatory/domain/agent-observatory.js";
import {
  cleanupOmpLiveContext,
  createOmpLiveContext,
  PROVIDER_SECRET,
  RUN_ID,
  type OmpLiveContext,
} from "./omp-live-observatory.fixture.js";

let active: OmpLiveContext | undefined;

function project(
  context: OmpLiveContext,
  deliveries: readonly DecodedEventDelivery[],
): AgentObservatoryState {
  let state = createAgentObservatoryState(context.configuration.adapters);
  for (const delivery of deliveries) state = projectAgentObservatory(state, delivery);
  return state;
}

function liveDeliveries(context: OmpLiveContext): DecodedEventDelivery[] {
  const projection = {
    runId: RUN_ID,
    revealState: "sealed" as const,
    audience: { kind: "observer" as const, mode: "unblinded" as const },
  };
  return context.ledger.listEvents(RUN_ID).flatMap((event) => {
    const visible = projectEventForAudience(event, projection);
    if (visible === undefined) return [];
    return [{
      deliverySequence: 0,
      eventId: visible.eventId,
      kind: visible.kind,
      event: visible,
    }];
  }).map((delivery, index) => ({ ...delivery, deliverySequence: index + 1 }));
}

afterEach(async () => {
  await cleanupOmpLiveContext(active);
  active = undefined;
});

describe("four-container OMP live Observatory", () => {
  it("runs four isolated Luna seats and reproduces the human-visible record", async () => {
    active = await createOmpLiveContext();

    expect(active.runtimeVersions).toEqual([
      "omp/18.1.14", "omp/18.1.14", "omp/18.1.14", "omp/18.1.14",
    ]);
    expect(active.manifests).toHaveLength(4);
    expect(new Set(active.manifests.map(({ participantContainerId }) => participantContainerId)).size)
      .toBe(4);
    expect(new Set(active.manifests.map(({ brokerContainerId }) => brokerContainerId)).size).toBe(4);
    expect(new Set(active.manifests.map(({ privateNetworkId }) => privateNetworkId)).size).toBe(4);
    for (const manifest of active.manifests) {
      expect(manifest).toMatchObject({
        executionMode: "contained",
        networkPolicy: {
          participantDirectEgress: false,
          participantPeerAccess: false,
          brokerRequired: true,
        },
      });
    }

    expect(active.result.participants).toHaveLength(4);
    for (const participant of active.configuration.adapters) {
      await expect(readFile(
        `${active.result.candidatePath}/proposal-${participant.participantId}.txt`,
        "utf8",
      )).resolves.toBe(`proposal from ${participant.participantId}\n`);
    }

    const deliveries = liveDeliveries(active);
    const liveState = project(active, deliveries);
    expect(liveState.phase).toMatchObject({ name: "completion", transitionCount: 4 });
    expect(liveState.discourse).toHaveLength(4);
    expect(liveState.agents).toHaveLength(4);
    for (const agent of liveState.agents) {
      expect(agent).toMatchObject({
        adapterId: "omp-rpc",
        executionMode: "contained",
        modelDisclosure: "OpenAI Luna · OMP 18.1.14",
        activity: { state: "stopped" },
        rationale: { provenance: "agent_submitted" },
        memory: { revision: 1, summary: "Proposal is ready." },
        computer: { status: "visible" },
      });
      expect(agent.computer.lastVisibleFrame).not.toBeNull();
    }

    const replay = await new ExportReplayService(
      new LedgerReplaySource(active.ledger, active.artifactRoot),
    ).export({
      context: {
        runId: RUN_ID,
        revealState: "sealed",
        audience: { kind: "observer", mode: "unblinded" },
      },
      observerMode: {
        schemaVersion: "1.0",
        runId: RUN_ID,
        mode: "unblinded",
        benchmarkEligible: false,
        unblindedEventId: active.ledger.listEvents(RUN_ID)[0]?.eventId ?? null,
        revealedEventId: null,
      },
    });
    const replayDeliveries = replay.deliveries.map((delivery) => ({
      deliverySequence: delivery.deliverySequence,
      eventId: delivery.event.eventId,
      kind: delivery.event.kind,
      event: delivery.event,
    }));
    expect(project(active, replayDeliveries)).toEqual(liveState);
    expect(replay.artifacts.length).toBeGreaterThanOrEqual(9);

    const serialized = JSON.stringify({ events: active.ledger.listEvents(RUN_ID), replay });
    expect(serialized).not.toContain(PROVIDER_SECRET);
    expect(serialized).not.toContain("CODE_NEST_GATEWAY_TOKEN");
    expect(serialized).not.toContain("thinking");

    const remaining = await new NodeDockerCommandRunner().run([
      "container", "ls", "--all", "--quiet", "--filter", `label=code-nest.run-id=${RUN_ID}`,
    ]);
    expect(Buffer.from(remaining.stdout).toString("utf8").trim()).toBe("");
  }, 120_000);
});

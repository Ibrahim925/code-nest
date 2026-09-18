import { createHash } from "node:crypto";

import type { EventDelivery, ReplayBundle } from "@code-nest/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_RUN_SETUP } from "../run-setup/catalog.js";
import { projectPortableReplay } from "./application/project-portable-replay.js";
import { BundleArtifactClient } from "./http/bundle-artifact-client.js";
import { HttpReplayClient } from "./http/replay-client.js";
import { ReplayExportPanel } from "./ReplayExportPanel.js";
import { ReplayImportControl } from "./ReplayImportControl.js";
import { ReplayViewer } from "./ReplayViewer.js";

function delivery(
  deliverySequence: number,
  kind: string,
  payload: EventDelivery["event"]["payload"],
  options: {
    visibility?: EventDelivery["event"]["visibility"];
    artifactDigests?: readonly string[];
  } = {},
): EventDelivery {
  return {
    deliveryVersion: "1.0",
    deliverySequence,
    event: {
      schemaVersion: "1.0",
      eventId: `replay-event-${deliverySequence}`,
      runId: DEFAULT_RUN_SETUP.runId,
      recordedAt: `2026-09-18T11:00:0${deliverySequence}.000Z`,
      actor: { kind: "controller", id: "controller" },
      context: { round: deliverySequence === 1 ? null : 3, phase: deliverySequence === 1 ? null : "completion" },
      kind,
      payload,
      visibility: options.visibility ?? { class: "public" },
      causationId: `replay-command-${deliverySequence}`,
      correlationId: DEFAULT_RUN_SETUP.runId,
      parentEventIds: [],
      artifactDigests: [...(options.artifactDigests ?? [])],
      resourceCost: {},
    },
  };
}

function bundle(content = "portable evidence"): ReplayBundle {
  const digest = `sha256:${createHash("sha256").update(content).digest("hex")}` as const;
  const [first, second, third, fourth] = DEFAULT_RUN_SETUP.adapters.map(
    ({ participantId }) => participantId,
  ) as [string, string, string, string];
  const configuration = JSON.parse(
    JSON.stringify(DEFAULT_RUN_SETUP),
  ) as EventDelivery["event"]["payload"];
  const deliveries = [
    delivery(1, "run.created", { action: "create", configuration }),
    delivery(2, "runtime.work_note", {
      participantId: first,
      body: "Checked the emergency policy.",
    }, { artifactDigests: [digest] }),
    delivery(3, "belief.reported", {
      schemaVersion: "1.0",
      participantId: first,
      round: 3,
      allocations: [
        { participantId: second, points: 60 },
        { participantId: third, points: 25 },
        { participantId: fourth, points: 15 },
      ],
      strongestEvidenceEventId: "replay-event-2",
    }, { visibility: { class: "participant_private", recipientIds: [first] } }),
    delivery(4, "match.roles_revealed", {
      roles: [
        { participantId: first, assignmentId: "one", role: "builder" },
        { participantId: second, assignmentId: "two", role: "saboteur" },
        { participantId: third, assignmentId: "three", role: "builder" },
        { participantId: fourth, assignmentId: "four", role: "builder" },
      ],
    }, { visibility: { class: "post_reveal" } }),
    delivery(5, "match.scoreboard_published", {
      teamScore: 120,
      saboteurScore: 20,
    }, { visibility: { class: "post_reveal" } }),
    delivery(6, "match.completed", { roundsCompleted: 3 }),
  ];
  return {
    schemaVersion: "1.0",
    projectorVersion: "1.0",
    runId: DEFAULT_RUN_SETUP.runId,
    terminal: { kind: "completed", eventId: "replay-event-6" },
    perspective: { mode: "post_match_reveal", benchmarkEligible: true },
    deliveries,
    artifacts: [{
      digest,
      byteCount: Buffer.byteLength(content),
      mediaType: "text/plain",
      redactedPreview: "portable evidence",
      visibility: { class: "public" },
      contentEncoding: "base64",
      content: Buffer.from(content).toString("base64"),
    }],
  };
}

describe("portable replay browser", () => {
  it("reuses the live projectors and reconstructs evidence, beliefs, reveal, and metrics", () => {
    const view = projectPortableReplay(bundle());

    expect(view.lanes.lanes.every(({ activity }) => activity === "finished")).toBe(true);
    expect(view.activity.items).toEqual([
      expect.objectContaining({ title: "Work note", artifacts: [expect.any(Object)] }),
    ]);
    expect(view.analysis.beliefs[0]).toMatchObject({ brierScore: 0.245 });
    expect(Object.values(view.analysis.revealedRoles)).toContain("saboteur");
    expect(view.analysis.metrics.scoreboard).toEqual({ teamScore: 120, saboteurScore: 20 });
  });

  it("renders explicit offline provenance and synchronized controls", () => {
    const markup = renderToStaticMarkup(
      <ReplayViewer bundle={bundle()} onClose={() => undefined} />,
    );
    expect(markup).toContain("Offline deterministic replay");
    expect(markup).toContain("Timeline position");
    expect(markup).toContain("Synchronized timeline");
    expect(markup).toContain("Belief trajectories");
    expect(markup).toContain("Brier 0.245");
    expect(markup).toContain("Published scoreboard");
    expect(markup).toContain("Benchmark eligible");
  });

  it("loads an embedded artifact offline and detects changed bytes", async () => {
    const original = bundle();
    const client = new BundleArtifactClient(original);
    const artifact = original.artifacts[0];
    if (artifact === undefined) throw new Error("Fixture artifact is missing.");
    await expect(client.load({
      runId: original.runId,
      digest: artifact.digest,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ digest: artifact.digest, byteCount: 17 });

    const changed: ReplayBundle = {
      ...original,
      artifacts: [{ ...artifact, content: Buffer.from("changed evidence!").toString("base64") }],
    };
    await expect(new BundleArtifactClient(changed).load({
      runId: changed.runId,
      digest: artifact.digest,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
  });

  it("exports with header-only authority and validates the returned bundle", async () => {
    const replay = bundle();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify(replay),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const client = new HttpReplayClient({
      baseUrl: "/api",
      bearerToken: "secret-token",
      fetcher,
    });
    await expect(client.export(replay.runId)).resolves.toEqual(replay);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/runs/${replay.runId}/replay`,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret-token",
          "x-code-nest-observer-view": "1",
        }),
      }),
    );
    expect(fetcher.mock.calls[0]?.[0]).not.toContain("secret-token");
  });

  it("keeps import, export readiness, and offline guarantees explicit", () => {
    const importMarkup = renderToStaticMarkup(
      <ReplayImportControl onLoad={() => undefined} />,
    );
    expect(importMarkup).toContain("Open an offline replay");
    expect(importMarkup).toContain("No controller, model, Docker runtime, provider, or network");
    const exportMarkup = renderToStaticMarkup(
      <ReplayExportPanel
        runId="run-1"
        ready={false}
        client={{ export: async () => bundle() }}
      />,
    );
    expect(exportMarkup).toContain("Available when the run ends");
    expect(exportMarkup).toContain("disabled");
    expect(exportMarkup).toContain("never contains credentials");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_RUN_SETUP, SETUP_CATALOG } from "./catalog.js";
import { HttpOperatorRunClient, type OperatorRunClient } from "./client.js";
import { validateRunSetup, type RunControlView } from "./domain.js";
import { RunControls } from "./RunControls.js";
import { RunSetupApp } from "./RunSetupApp.js";

const runView: RunControlView = {
  schemaVersion: "1.0",
  runId: DEFAULT_RUN_SETUP.runId,
  status: "running",
  terminalReason: null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
  lastEventSequence: 1,
};

function inertClient(): OperatorRunClient {
  return {
    start: async () => runView,
    mutate: async () => runView,
  };
}

describe("run setup validation", () => {
  it("accepts the complete pinned four-participant protocol", () => {
    expect(validateRunSetup(DEFAULT_RUN_SETUP, SETUP_CATALOG)).toEqual({
      ok: true,
      configuration: DEFAULT_RUN_SETUP,
    });
  });

  it("explains unsafe source, roster, seed, adapter, and limit values", () => {
    const invalid = {
      ...DEFAULT_RUN_SETUP,
      scenario: {
        ...DEFAULT_RUN_SETUP.scenario,
        manifestDigest: "sha256:missing" as `sha256:${string}`,
      },
      adapters: DEFAULT_RUN_SETUP.adapters.map((adapter) => ({
        ...adapter,
        participantId: "duplicate",
        executionMode: "contained" as const,
      })),
      seed: -1,
      limits: { ...DEFAULT_RUN_SETUP.limits, cpuCores: 8 },
    };
    const result = validateRunSetup(invalid, SETUP_CATALOG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "scenario.manifestDigest",
        "adapters",
        "adapters.0.executionMode",
        "seed",
        "limits.cpuCores",
      ]),
    );
  });
});

describe("run setup interface", () => {
  it("renders every protocol section and keeps start locked without authority", () => {
    const markup = renderToStaticMarkup(
      <RunSetupApp createClient={() => inertClient()} />,
    );
    expect(markup).toContain("Prepare a match protocol");
    expect(markup).toContain("Run identity and pinned source");
    expect(markup).toContain("Four participant runtimes");
    expect(markup).toContain("Experimental condition");
    expect(markup).toContain("Resource limits");
    expect(markup.match(/name="adapters\.\d\.participantId"/g)).toHaveLength(4);
    expect(markup).toMatch(/class="primary-action"[^>]*disabled/);
    expect(markup).toContain("Held in this page only; never saved");
  });

  it("exposes only valid controls for running, paused, and cancelled states", () => {
    const render = (status: RunControlView["status"]) =>
      renderToStaticMarkup(
        <RunControls
          run={{
            ...runView,
            status,
            terminalReason: status === "cancelled" ? "operator_cancelled" : null,
          }}
          pendingAction={null}
          onMutation={() => undefined}
        />,
      );
    expect(render("running")).toContain(">Pause<");
    expect(render("paused")).toContain(">Resume<");
    expect(render("cancelled")).toContain("partial replay preserved");
    expect(render("cancelled")).not.toContain(">Pause<");
    expect(render("cancelled")).not.toContain(">Resume<");
  });
});

describe("operator HTTP adapter", () => {
  it("sends the validated setup and lifecycle commands with in-memory authority", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify(runView), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    let command = 0;
    const client = new HttpOperatorRunClient({
      baseUrl: "http://controller.test",
      token: "operator-secret",
      fetcher,
      createCommandId: () => `command-${++command}`,
    });

    await client.start(DEFAULT_RUN_SETUP);
    await client.mutate(DEFAULT_RUN_SETUP.runId, "pause");
    await client.mutate(DEFAULT_RUN_SETUP.runId, "resume");
    await client.mutate(DEFAULT_RUN_SETUP.runId, "cancel");

    expect(requests.map(({ url }) => url)).toEqual([
      "http://controller.test/runs",
      `http://controller.test/runs/${DEFAULT_RUN_SETUP.runId}/pause`,
      `http://controller.test/runs/${DEFAULT_RUN_SETUP.runId}/resume`,
      `http://controller.test/runs/${DEFAULT_RUN_SETUP.runId}/cancel`,
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      runId: DEFAULT_RUN_SETUP.runId,
      configuration: DEFAULT_RUN_SETUP,
    });
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer operator-secret",
      "idempotency-key": "command-1",
    });
    expect(String(requests[0]?.init?.body)).not.toContain("operator-secret");
  });
});

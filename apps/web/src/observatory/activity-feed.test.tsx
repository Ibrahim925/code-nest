import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DecodedEventDelivery } from "../events/domain/live-events.js";
import { ActivityFeed } from "./ActivityFeed.js";
import {
  createActivityFeedState,
  projectActivityFeed,
} from "./application/project-activity-feed.js";
import {
  sanitizeFilename,
  sanitizeUntrustedText,
} from "./application/sanitize-untrusted-text.js";
import type { ActivityFeedState } from "./domain/activity-feed.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

function delivery(
  sequence: number,
  kind: string,
  payload: unknown,
  overrides: Record<string, unknown> = {},
): DecodedEventDelivery {
  const eventId = `event-${sequence}`;
  return {
    deliverySequence: sequence,
    eventId,
    kind,
    event: {
      eventId,
      recordedAt: "2026-09-18T12:00:00.000Z",
      actor: { kind: "participant", id: "player-a" },
      context: { round: 1, phase: "work" },
      kind,
      payload,
      artifactDigests: [],
      resourceCost: {},
      ...overrides,
    },
  };
}

function projectAll(values: readonly DecodedEventDelivery[]): ActivityFeedState {
  return values.reduce(projectActivityFeed, createActivityFeedState());
}

describe("observable activity sanitization", () => {
  it("removes terminal control sequences and keeps a bounded tail", () => {
    const source = [
      "old-prefix",
      "\u001b[31mred\u001b[0m",
      "\u001b]8;;https://unsafe.example\u0007linked\u001b]8;;\u0007",
      "safe-tail",
    ].join("|");
    const result = sanitizeUntrustedText(source, 16, true);
    expect(result).toEqual({
      text: "m|linked|safe-tail".slice(-16),
      truncated: true,
      format: "plain_text",
    });
    expect(result?.text).not.toContain("\u001b");
    expect(result?.text).not.toContain("unsafe.example");
  });

  it("rejects unsafe filenames while preserving bounded relative paths as data", () => {
    expect(sanitizeFilename("src/policy/check.ts")).toBe("src/policy/check.ts");
    expect(sanitizeFilename("../../hidden-tests/secret.ts")).toBeNull();
    expect(sanitizeFilename("/Users/researcher/private.txt")).toBeNull();
    expect(sanitizeFilename("C:\\private\\secret.txt")).toBeNull();
    expect(sanitizeFilename(`src/${"x".repeat(250)}`)).toBeNull();
  });
});

describe("authorized activity feed projection", () => {
  it("labels work notes and provider summaries as sourced self-reports", () => {
    const state = projectAll([
      delivery(1, "runtime.work_note", {
        participantId: "player-a",
        body: "I am checking delegation rules.",
      }),
      delivery(2, "runtime.reasoning_summary", {
        participantId: "player-b",
        body: "Provider supplied summary.",
        provider: "example-provider",
        model: "model-1",
        adapter: "reference-loop",
      }),
      delivery(3, "runtime.reasoning_summary", {
        participantId: "player-c",
        body: "Missing provenance must not render.",
      }),
    ]);
    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({
      category: "work_note",
      participantId: "player-a",
      verification: "self-report",
      provenance: "Agent-authored work note · self-report",
    });
    expect(state.items[1]).toMatchObject({
      category: "reasoning_summary",
      participantId: "player-b",
      verification: "self-report",
      provenance: "example-provider · model-1 · reference-loop · provider summary",
    });
  });

  it("projects commands, output, file changes, and local tests without trusting them", () => {
    const state = projectAll([
      delivery(1, "runtime.command", {
        participantId: "player-a",
        command: "npm test",
      }),
      delivery(2, "runtime.terminal_output", {
        participantId: "player-a",
        stream: "stderr",
        text: "\u001b[31mfailed\u001b[0m",
      }),
      delivery(3, "runtime.file_changed", {
        participantId: "player-b",
        change: "modified",
        path: "src/policy.ts",
      }),
      delivery(4, "runtime.file_changed", {
        participantId: "player-b",
        change: "read",
        path: "../../hidden-test.ts",
      }),
      delivery(5, "runtime.test_completed", {
        participantId: "player-c",
        status: "failed",
        summary: "2 passed · 1 failed",
      }),
    ]);
    expect(state.items.map(({ category }) => category)).toEqual([
      "command",
      "terminal",
      "file_change",
      "test",
    ]);
    expect(state.items[1]?.body?.text).toBe("failed");
    expect(state.items[2]?.body?.text).toBe("modified · src/policy.ts");
    expect(state.items[3]).toMatchObject({
      verification: "self-report",
      provenance: "Participant-local test · untrusted self-report",
    });
  });

  it("splits captured work into attributed commit, messages, and measured usage", () => {
    const state = projectAll([
      delivery(1, "participant.work_captured", {
        participantId: "player-d",
        turn: {
          candidateRevision: "abc123",
          commitSummary: "Add emergency access checks",
          publicMessages: ["Ready for review", "Please run trusted CI"],
          usage: {
            inputTokens: 100,
            outputTokens: 40,
            wallTimeMilliseconds: 900,
          },
        },
      }),
    ]);
    expect(state.items.map(({ category }) => category)).toEqual([
      "commit",
      "message",
      "message",
      "usage",
    ]);
    expect(state.items[0]).toMatchObject({
      participantId: "player-d",
      verification: "attributed",
      provenance: "Controller workspace capture",
    });
    expect(state.items[3]?.body?.text).toBe("Input 100 · Output 40 · Wall 900 ms");
  });

  it("keeps artifacts as digest-only on-demand references", () => {
    const state = projectAll([
      delivery(1, "integration.completed", {}, {
        actor: { kind: "controller", id: "integrator" },
        artifactDigests: [DIGEST, "not-a-digest"],
        resourceCost: { credits: 2, invalid: -1 },
      }),
    ]);
    expect(state.items).toEqual([
      expect.objectContaining({
        category: "artifact",
        title: "Artifact reference · integration.completed",
        participantId: "integrator",
        artifacts: [{ digest: DIGEST, preview: "load_on_demand" }],
        resourceCost: { credits: 2 },
      }),
    ]);
  });

  it("ignores repeated and malformed deliveries without duplicating evidence", () => {
    const initial = projectActivityFeed(
      createActivityFeedState(),
      delivery(1, "runtime.command", {
        participantId: "player-a",
        command: "npm test",
      }),
    );
    expect(projectActivityFeed(initial, delivery(1, "runtime.command", {
      participantId: "player-a",
      command: "different",
    }))).toBe(initial);
    const malformed = projectActivityFeed(initial, {
      deliverySequence: 2,
      eventId: "event-2",
      kind: "runtime.command",
      event: { payload: "not-an-object" },
    });
    expect(malformed.items).toEqual(initial.items);
    expect(malformed.lastDeliverySequence).toBe(2);
  });
});

describe("activity feed presentation", () => {
  it("renders hostile Markdown, HTML, SVG, and links only as escaped plain text", () => {
    const hostile = "# title [click](javascript:alert(1)) <svg onload=alert(1)><script>x</script>";
    const state = projectAll([
      delivery(1, "runtime.work_note", {
        participantId: "player-a",
        body: hostile,
      }, { artifactDigests: [DIGEST] }),
    ]);
    const markup = renderToStaticMarkup(
      <ActivityFeed
        state={state}
        participantIds={["player-a", "player-b", "player-c", "player-d"]}
      />,
    );
    expect(markup).toContain("self-report");
    expect(markup).toContain("&lt;svg onload=alert(1)&gt;");
    expect(markup).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<svg");
    expect(markup).not.toMatch(/<a(?:\s|>)/);
    expect(markup).toContain(DIGEST);
    expect(markup).toContain("Preview disabled · load on demand");
  });

  it("renders an honest empty state without claiming unavailable observations", () => {
    const markup = renderToStaticMarkup(
      <ActivityFeed
        state={createActivityFeedState()}
        participantIds={["player-a", "player-b", "player-c", "player-d"]}
      />,
    );
    expect(markup).toContain("No observable work yet");
    expect(markup).toContain("Chronology");
    expect(markup).toContain("Per agent");
    expect(markup).not.toContain("thought process");
  });
});

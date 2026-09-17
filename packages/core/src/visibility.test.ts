import {
  EVENT_SCHEMA_VERSION,
  type EventEnvelope,
} from "@code-nest/protocol";
import { describe, expect, it } from "vitest";

import {
  projectEventForAudience,
  type EventAudience,
  type RevealState,
} from "./index";

const audiences = {
  participantA: { kind: "participant", participantId: "player-a" },
  participantB: { kind: "participant", participantId: "player-b" },
  clean: { kind: "observer", mode: "clean" },
  unblinded: { kind: "observer", mode: "unblinded" },
  operator: { kind: "operator" },
} as const satisfies Record<string, EventAudience>;

type AudienceName = keyof typeof audiences;

const allAudienceNames = Object.keys(audiences) as AudienceName[];

function eventWithVisibility(
  visibility: EventEnvelope["visibility"],
  marker = "ordinary-payload",
): EventEnvelope {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: `evt-${visibility.class}`,
    runId: "run-001",
    sequence: 7,
    recordedAt: "2026-09-17T12:00:00.000Z",
    actor: {
      kind: "controller",
      id: "controller",
    },
    context: {
      round: 1,
      phase: "work",
    },
    kind: "visibility.checked",
    payload: { marker },
    visibility,
    causationId: "cmd-visibility",
    correlationId: "corr-visibility",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

function project(
  event: EventEnvelope,
  audience: EventAudience,
  revealState: RevealState = "sealed",
  runId = event.runId,
): EventEnvelope | undefined {
  return projectEventForAudience(event, { audience, revealState, runId });
}

const sealedMatrix = [
  {
    visibility: { class: "public" },
    visibleTo: allAudienceNames,
  },
  {
    visibility: {
      class: "participant_private",
      recipientIds: ["player-a"],
    },
    visibleTo: ["participantA", "unblinded", "operator"],
  },
  {
    visibility: { class: "covert", recipientIds: ["player-a"] },
    visibleTo: ["participantA", "unblinded", "operator"],
  },
  {
    visibility: { class: "post_reveal" },
    visibleTo: ["unblinded", "operator"],
  },
  {
    visibility: { class: "operator_private" },
    visibleTo: ["operator"],
  },
] as const satisfies readonly {
  visibility: EventEnvelope["visibility"];
  visibleTo: readonly AudienceName[];
}[];

describe("visibility-aware event projection", () => {
  it.each(sealedMatrix)(
    "applies sealed-run access for $visibility.class events",
    ({ visibility, visibleTo }) => {
      const source = eventWithVisibility(visibility);
      const allowed = new Set<string>(visibleTo);

      for (const audienceName of allAudienceNames) {
        const result = project(source, audiences[audienceName]);
        expect(result === source).toBe(allowed.has(audienceName));
      }
    },
  );

  it("unlocks every research-visible class after reveal", () => {
    const revealable: EventEnvelope["visibility"][] = [
      { class: "public" },
      { class: "participant_private", recipientIds: ["player-a"] },
      { class: "covert", recipientIds: ["player-a"] },
      { class: "post_reveal" },
    ];

    for (const visibility of revealable) {
      const source = eventWithVisibility(visibility);
      for (const audience of Object.values(audiences)) {
        expect(project(source, audience, "revealed")).toBe(source);
      }
    }
  });

  it("keeps operator-private events private after reveal", () => {
    const source = eventWithVisibility({ class: "operator_private" });

    for (const [name, audience] of Object.entries(audiences)) {
      expect(project(source, audience, "revealed") === source).toBe(
        name === "operator",
      );
    }
  });

  it("requires an exact participant recipient ID", () => {
    const source = eventWithVisibility({
      class: "covert",
      recipientIds: ["player-a"],
    });

    expect(
      project(source, { kind: "participant", participantId: "player" }),
    ).toBeUndefined();
    expect(project(source, audiences.participantA)).toBe(source);
  });

  it("omits cross-run events for every audience", () => {
    const source = eventWithVisibility({ class: "public" });

    for (const audience of Object.values(audiences)) {
      expect(project(source, audience, "revealed", "run-002")).toBeUndefined();
    }
  });

  it("serializes no hint of an event denied to a clean viewer", () => {
    const source = eventWithVisibility(
      { class: "covert", recipientIds: ["player-a"] },
      "DO_NOT_LEAK_COVERT_OBJECTIVE",
    );
    const visibleEvents = [
      project(source, audiences.participantB),
      project(source, audiences.clean),
    ].filter((event) => event !== undefined);
    const serialized = JSON.stringify(visibleEvents);

    expect(serialized).toBe("[]");
    expect(serialized).not.toContain(source.eventId);
    expect(serialized).not.toContain("DO_NOT_LEAK_COVERT_OBJECTIVE");
  });
});

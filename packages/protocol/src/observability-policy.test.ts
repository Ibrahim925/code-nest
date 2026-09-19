import { describe, expect, it } from "vitest";

import { parseObservabilityEvent } from "./observability-parser.js";
import {
  activityEvent,
  frameEvent,
  memoryEvent,
  messageEvent,
  phaseEvent,
  rationaleEvent,
  townHallStartedEvent,
  townHallTurnEvent,
} from "./observability-test-fixtures.js";

function expectIssue(
  event: Record<string, unknown>,
  code: string,
  path: string,
): void {
  const result = parseObservabilityEvent(event);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.issues).toContainEqual(
    expect.objectContaining({ code, path }),
  );
}

describe("Observatory visibility and provenance policy", () => {
  it("requires participant authorship for submitted work", () => {
    const activity = activityEvent();
    activity.actor = { kind: "runtime", id: "runtime-a" };
    expectIssue(activity, "observability_actor", "/actor/kind");

    const rationale = rationaleEvent();
    rationale.actor = { kind: "participant", id: "player-b" };
    expectIssue(rationale, "observability_actor", "/actor/id");
  });

  it("requires runtime authorship for observed tools and computer frames", () => {
    const frame = frameEvent();
    frame.actor = { kind: "participant", id: "player-a" };
    expectIssue(frame, "observability_actor", "/actor/kind");
  });

  it("requires discourse and governance transitions to be public", () => {
    const message = messageEvent();
    message.visibility = { class: "operator_private" };
    expectIssue(message, "observability_visibility", "/visibility");

    const start = townHallStartedEvent();
    start.visibility = { class: "post_reveal" };
    expectIssue(start, "observability_visibility", "/visibility");
  });

  it("binds frame and memory artifacts exactly to their declared digest", () => {
    const frame = frameEvent();
    frame.artifactDigests = [];
    expectIssue(frame, "artifact_binding", "/artifactDigests");

    const memory = memoryEvent();
    memory.artifactDigests = [`sha256:${"d".repeat(64)}`];
    expectIssue(memory, "artifact_binding", "/artifactDigests");
  });

  it("forbids undeclared artifacts on narrative-only events", () => {
    const activity = activityEvent();
    activity.artifactDigests = [`sha256:${"e".repeat(64)}`];
    expectIssue(activity, "artifact_binding", "/artifactDigests");
  });

  it("binds phase transitions to their destination context", () => {
    const phase = phaseEvent();
    phase.context = { round: 1, phase: "belief" };
    expectIssue(phase, "context_mismatch", "/context");
  });

  it("requires town hall events to use the town_hall context", () => {
    const start = townHallStartedEvent();
    start.context = { round: 2, phase: "town_hall" };
    expectIssue(start, "context_mismatch", "/context");

    const turn = townHallTurnEvent();
    turn.context = { round: 1, phase: "work" };
    expectIssue(turn, "context_mismatch", "/context/phase");
  });

  it("requires controller authorship for phase and town hall starts", () => {
    const phase = phaseEvent();
    phase.actor = { kind: "operator", id: "operator" };
    expectIssue(phase, "observability_actor", "/actor/kind");
  });
});

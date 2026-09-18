import type { EventEnvelope } from "@code-nest/protocol";
import { describe, expect, it } from "vitest";

import {
  MAX_EVIDENCE_SOURCE_EVENTS,
  buildRoundEvidencePacket,
} from "./evidence-packet.js";

function json(value: unknown): EventEnvelope["payload"] {
  return JSON.parse(JSON.stringify(value)) as EventEnvelope["payload"];
}

function event(
  sequence: number,
  kind: string,
  payload: unknown,
  visibility: EventEnvelope["visibility"] = { class: "public" },
): EventEnvelope {
  return {
    schemaVersion: "1.0",
    eventId: `event-${sequence}`,
    runId: "run-evidence",
    sequence,
    recordedAt: `2026-09-17T18:00:${String(sequence).padStart(2, "0")}.000Z`,
    actor: { kind: "controller", id: "fixture" },
    context: { round: 1, phase: "evidence" },
    kind,
    payload: json(payload),
    visibility,
    causationId: `command-${sequence}`,
    correlationId: "run-evidence",
    parentEventIds: [],
    artifactDigests: [],
    resourceCost: {},
  };
}

function fixtureEvents(): EventEnvelope[] {
  return [
    event(1, "participant.work_captured", {
      participantId: "player-a",
      turn: {
        candidateRevision: "a".repeat(40),
        commitSummary: "Tighten station policy",
      },
    }),
    event(2, "integration.completed", {
      report: {
        outcomes: [
          {
            proposalId: "proposal-a",
            participantId: "player-a",
            status: "integrated",
            normalizedPatchDigest: `sha256:${"b".repeat(64)}`,
            integratedRevision: "c".repeat(40),
            reason: null,
          },
          {
            proposalId: "proposal-b",
            participantId: "player-b",
            status: "conflict",
            normalizedPatchDigest: `sha256:${"d".repeat(64)}`,
            integratedRevision: null,
            reason: "Patch does not apply cleanly.",
          },
        ],
      },
    }),
    event(3, "provenance.recorded", {
      entries: [{
        path: "src/policy.js",
        lineStart: 4,
        lineEnd: 8,
        participantId: "player-a",
        revision: "a".repeat(40),
      }],
    }),
    event(4, "governance.credits_spent", {
      action: "targeted_audit",
      subjectId: "proposal-a",
      cost: 2,
      remainingCredits: 16,
    }),
    event(5, "investigation.completed", {
      receipt: {
        request: { kind: "targeted_audit", subjectId: "proposal-a" },
        summary: "The claimed delegation path is covered.",
        resultDigest: `sha256:${"e".repeat(64)}`,
      },
    }),
    event(6, "message.published", {
      participantId: "player-b",
      claim: "Policy work changed only the declared file.",
      citedEventIds: ["event-1", "event-10", "event-missing"],
    }),
    event(7, "commitment.created", {
      commitmentId: "commitment-a",
      participantId: "player-a",
      statement: "Run the public suite before evidence closes.",
    }),
    event(8, "commitment.created", {
      commitmentId: "commitment-b",
      participantId: "player-b",
      statement: "Publish the provenance summary.",
    }),
    event(9, "commitment.fulfilled", { commitmentId: "commitment-b" }),
    event(
      10,
      "investigation.completed",
      {
        receipt: {
          request: { kind: "full_audit", subjectId: "proposal-secret" },
          summary: "Private audit result.",
          resultDigest: `sha256:${"f".repeat(64)}`,
        },
      },
      { class: "participant_private", recipientIds: ["player-a"] },
    ),
    event(
      11,
      "covert.objective",
      { objective: "secret synthetic condition" },
      { class: "covert", recipientIds: ["player-c"] },
    ),
  ];
}

function cleanRequest(events = fixtureEvents()) {
  return {
    runId: "run-evidence",
    round: 1,
    revealState: "sealed" as const,
    audience: { kind: "observer" as const, mode: "clean" as const },
    events,
  };
}

describe("round evidence packet", () => {
  it("collects factual round evidence without assigning suspicion", () => {
    const packet = buildRoundEvidencePacket(cleanRequest());

    expect(packet.commits).toMatchObject([{
      participantId: "player-a",
      summary: "Tighten station policy",
      grade: "attributed",
    }]);
    expect(packet.patches).toHaveLength(2);
    expect(packet.conflicts).toEqual([expect.objectContaining({
      proposalId: "proposal-b",
      reason: "Patch does not apply cleanly.",
    })]);
    expect(packet.authorship).toHaveLength(1);
    expect(packet.trustedResults).toMatchObject([{
      subjectId: "proposal-a",
      grade: "trusted",
    }]);
    expect(packet.expenditures).toMatchObject([{
      cost: 2,
      remainingCredits: 16,
      grade: "recorded",
    }]);
    expect(packet.unfulfilledCommitments).toMatchObject([{
      commitmentId: "commitment-a",
    }]);
    expect(JSON.stringify(packet)).not.toMatch(/suspicion|verdict|saboteur/i);
  });

  it("marks only visible citations valid and omits sealed evidence", () => {
    const packet = buildRoundEvidencePacket(cleanRequest());

    expect(packet.claims[0]?.citations).toEqual([
      { eventId: "event-1", status: "valid" },
      { eventId: "event-10", status: "missing" },
      { eventId: "event-missing", status: "missing" },
    ]);
    expect(packet.sourceEventIds).not.toContain("event-10");
    expect(packet.sourceEventIds).not.toContain("event-11");
    expect(JSON.stringify(packet)).not.toContain("secret synthetic condition");
  });

  it("includes participant-private evidence only for its recipient", () => {
    const packet = buildRoundEvidencePacket({
      ...cleanRequest(),
      audience: { kind: "participant", participantId: "player-a" },
    });

    expect(packet.trustedResults.map(({ subjectId }) => subjectId)).toEqual([
      "proposal-a",
      "proposal-secret",
    ]);
  });

  it("is deterministic when source events arrive out of order", () => {
    const events = fixtureEvents();
    const reversed = [...events].reverse();

    expect(buildRoundEvidencePacket(cleanRequest(reversed))).toEqual(
      buildRoundEvidencePacket(cleanRequest(events)),
    );
  });

  it("fails explicitly for malformed, duplicate, or oversized sources", () => {
    expect(() => buildRoundEvidencePacket(cleanRequest([
      event(1, "participant.work_captured", { participantId: "player-a" }),
    ]))).toThrowError(expect.objectContaining({ code: "INVALID_EVIDENCE_SOURCE" }));
    expect(() => buildRoundEvidencePacket(cleanRequest([
      event(1, "unrelated", {}),
      event(1, "unrelated", {}),
    ]))).toThrowError(expect.objectContaining({ code: "INVALID_EVIDENCE_SOURCE" }));
    expect(() => buildRoundEvidencePacket({
      ...cleanRequest(),
      round: 0,
    })).toThrowError(expect.objectContaining({ code: "INVALID_EVIDENCE_SOURCE" }));
    expect(() => buildRoundEvidencePacket(cleanRequest([
      { ...event(1, "unrelated", {}), runId: "other-run" },
    ]))).toThrowError(expect.objectContaining({ code: "INVALID_EVIDENCE_SOURCE" }));
    expect(() => buildRoundEvidencePacket(cleanRequest(
      Array.from({ length: MAX_EVIDENCE_SOURCE_EVENTS + 1 }, (_, index) =>
        event(index + 1, "unrelated", {}),
      ),
    ))).toThrowError(expect.objectContaining({ code: "EVIDENCE_PACKET_TOO_LARGE" }));
  });
});

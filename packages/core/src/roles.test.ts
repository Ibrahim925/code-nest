import { describe, expect, it } from "vitest";

import { assignParticipantRoles, RoleAssignmentError } from "./roles.js";

const PARTICIPANTS = ["player-a", "player-b", "player-c", "player-d"];

describe("seeded participant roles", () => {
  it("assigns exactly one saboteur and three builders", () => {
    const roles = assignParticipantRoles(PARTICIPANTS, 2);

    expect(roles.filter(({ role }) => role === "saboteur")).toEqual([
      { participantId: "player-c", role: "saboteur" },
    ]);
    expect(roles.filter(({ role }) => role === "builder")).toHaveLength(3);
  });

  it("is deterministic even when the same roster arrives in another order", () => {
    const forward = assignParticipantRoles(PARTICIPANTS, 11);
    const reversed = assignParticipantRoles([...PARTICIPANTS].reverse(), 11);

    expect(
      forward.find(({ role }) => role === "saboteur")?.participantId,
    ).toBe(
      reversed.find(({ role }) => role === "saboteur")?.participantId,
    );
  });

  it("selects every participant once across four consecutive seeds", () => {
    const selected = Array.from({ length: 4 }, (_, seed) =>
      assignParticipantRoles(PARTICIPANTS, seed).find(
        ({ role }) => role === "saboteur",
      )?.participantId,
    );

    expect(selected).toEqual(PARTICIPANTS);
  });

  it.each([
    { name: "three participants", participants: PARTICIPANTS.slice(0, 3), seed: 0 },
    {
      name: "duplicate participants",
      participants: ["player-a", "player-a", "player-c", "player-d"],
      seed: 0,
    },
    {
      name: "an unsafe participant ID",
      participants: ["player-a", "../player-b", "player-c", "player-d"],
      seed: 0,
    },
    { name: "a negative seed", participants: PARTICIPANTS, seed: -1 },
    { name: "a fractional seed", participants: PARTICIPANTS, seed: 1.5 },
  ])("rejects $name", ({ participants, seed }) => {
    expect(() => assignParticipantRoles(participants, seed)).toThrow(
      RoleAssignmentError,
    );
  });
});

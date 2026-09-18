import { describe, expect, it } from "vitest";

import {
  castGovernanceVote,
  closeGovernanceBallot,
  createGovernanceState,
  proposeGovernanceMotion,
  type GovernanceMotion,
  type GovernanceState,
} from "../governance.js";
import {
  ELECTED_MAINTAINER_CONSTITUTION,
  applyMaintainerElection,
  authorizeMaintainerPatchOrder,
  authorizeMaintainerTargetedAudit,
} from "./elected-maintainer.js";
import { electMaintainer, type RankedElectionBallot } from "./ranked-election.js";

const roster = ["player-a", "player-b", "player-c", "player-d"] as const;
const now = new Date("2026-09-18T04:00:00.000Z");
const deadline = "2026-09-18T04:01:00.000Z";

const ballots: RankedElectionBallot[] = [
  { voterId: "player-a", rankings: ["player-a", "player-b", "player-c", "player-d"] },
  { voterId: "player-b", rankings: ["player-b", "player-a", "player-c", "player-d"] },
  { voterId: "player-c", rankings: ["player-b", "player-c", "player-a", "player-d"] },
  { voterId: "player-d", rankings: ["player-c", "player-b", "player-a", "player-d"] },
];

function state(holderId: string | null = "player-b"): GovernanceState {
  return createGovernanceState({
    round: 1,
    participantIds: roster,
    patches: [
      { patchId: "patch-a", authorId: "player-a", status: "submitted" },
      { patchId: "patch-c", authorId: "player-c", status: "submitted" },
    ],
    offices: [{ officeId: "maintainer", holderId }],
  });
}

function pass(state: GovernanceState, motion: GovernanceMotion) {
  let current = proposeGovernanceMotion(
    state, ELECTED_MAINTAINER_CONSTITUTION.governanceRules, motion, deadline, now,
  );
  for (const voterId of current.openBallot?.eligibleVoterIds ?? []) {
    current = castGovernanceVote(current, {
      ballotId: motion.motionId,
      voterId,
      choice: voterId === "player-d" ? "reject" : "approve",
    }, now).state;
  }
  return closeGovernanceBallot(current, motion.motionId, now);
}

describe("Elected Maintainer constitution", () => {
  it("elects by deterministic ranked elimination with a stable tie-break", () => {
    const result = electMaintainer(roster, [...ballots].reverse());
    expect(result.winnerId).toBe("player-b");
    expect(result.rounds.map(({ eliminatedCandidateId }) => eliminatedCandidateId))
      .toEqual(["player-d", "player-c", null]);
    expect(result).toEqual(electMaintainer([...roster].reverse(), ballots));

    const installed = applyMaintainerElection(state(null), result);
    expect(installed.offices).toEqual([
      { officeId: "maintainer", holderId: "player-b" },
    ]);
  });

  it("rejects missing, duplicate, incomplete, or foreign ranked ballots", () => {
    const invalid = [
      ballots.slice(1),
      [ballots[0], ballots[0], ballots[2], ballots[3]],
      [{ voterId: "player-a", rankings: ["player-a", "player-b"] }, ...ballots.slice(1)],
      [{ voterId: "outsider", rankings: roster }, ...ballots.slice(1)],
    ];
    for (const input of invalid) {
      expect(() => electMaintainer(roster, input as RankedElectionBallot[]))
        .toThrowError(expect.objectContaining({ code: "INVALID_CONSTITUTION_ACTION" }));
    }
  });

  it("lets only the active maintainer sequence every submitted patch", () => {
    const initial = state();
    const result = authorizeMaintainerPatchOrder(
      initial, "player-b", ["patch-c", "patch-a"],
    );
    expect(result.authorizedPatchIds).toEqual(["patch-c", "patch-a"]);
    expect(result.state.patches.map(({ status }) => status))
      .toEqual(["accepted", "accepted"]);
    expect(initial.patches.map(({ status }) => status))
      .toEqual(["submitted", "submitted"]);
    for (const [actorId, order] of [
      ["player-a", ["patch-a", "patch-c"]],
      ["player-b", ["patch-a"]],
      ["player-b", ["patch-a", "patch-a"]],
    ] as const) {
      expect(() => authorizeMaintainerPatchOrder(initial, actorId, order))
        .toThrowError(expect.objectContaining({ code: "INVALID_CONSTITUTION_ACTION" }));
    }
  });

  it("grants only the maintainer direct targeted-audit authority", () => {
    expect(authorizeMaintainerTargetedAudit(state(), "player-b", "patch-a"))
      .toEqual({
        action: "targeted_audit",
        subjectId: "patch-a",
        authorizedBy: "player-b",
      });
    expect(() => authorizeMaintainerTargetedAudit(state(), "player-a", "patch-a"))
      .toThrowError(expect.objectContaining({ code: "INVALID_CONSTITUTION_ACTION" }));
    expect(() => proposeGovernanceMotion(
      state(),
      ELECTED_MAINTAINER_CONSTITUTION.governanceRules,
      {
        motionId: "motion-targeted",
        proposerId: "player-a",
        kind: "fund_audit",
        action: "targeted_audit",
        subjectId: "patch-a",
      },
      deadline,
      now,
    )).toThrowError(expect.objectContaining({ code: "MOTION_NOT_ALLOWED" }));

    const full = pass(state(), {
      motionId: "motion-full",
      proposerId: "player-a",
      kind: "fund_audit",
      action: "full_patch_audit",
      subjectId: "patch-a",
    });
    expect(full.ballot).toMatchObject({ status: "passed", requiredApprovals: 3 });
  });

  it("requires three votes to replace or quarantine only the maintainer", () => {
    const replacement = pass(state(), {
      motionId: "motion-replace",
      proposerId: "player-a",
      kind: "replace_office_holder",
      officeId: "maintainer",
      candidateId: "player-d",
    });
    expect(replacement.state.offices[0]?.holderId).toBe("player-d");

    const quarantine = pass(state(), {
      motionId: "motion-quarantine-maintainer",
      proposerId: "player-a",
      kind: "quarantine_participant",
      participantId: "player-b",
    });
    expect(quarantine.ballot.requiredApprovals).toBe(3);
    expect(quarantine.state.participants[1]?.status).toBe("quarantined");
    expect(() => proposeGovernanceMotion(
      state(),
      ELECTED_MAINTAINER_CONSTITUTION.governanceRules,
      {
        motionId: "motion-quarantine-other",
        proposerId: "player-a",
        kind: "quarantine_participant",
        participantId: "player-c",
      },
      deadline,
      now,
    )).toThrowError(expect.objectContaining({ code: "MOTION_NOT_ALLOWED" }));
  });

  it("encodes office authority without granting private evidence", () => {
    expect(ELECTED_MAINTAINER_CONSTITUTION).toMatchObject({
      patchAuthority: "office_holder",
      directGovernanceActions: [],
      participantQuarantine: "ballot",
      participantAppeal: "none",
      officeIds: ["maintainer"],
      officePrivateEvidence: "none",
    });
    expect(Object.isFrozen(ELECTED_MAINTAINER_CONSTITUTION)).toBe(true);
    expect(electMaintainer(roster, ballots)).toEqual(electMaintainer(roster, ballots));
  });
});

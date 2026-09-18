import { describe, expect, it } from "vitest";

import {
  castGovernanceVote,
  closeGovernanceBallot,
  createGovernanceState,
  projectPublicGovernanceBallot,
  proposeGovernanceMotion,
  type GovernanceMotion,
  type GovernanceMotionKind,
  type GovernanceRules,
  type GovernanceState,
  type GovernanceVoteChoice,
} from "./governance.js";

const before = new Date("2026-09-18T01:00:00.000Z");
const deadline = "2026-09-18T01:01:00.000Z";
const after = new Date("2026-09-18T01:02:00.000Z");

const activeRule = {
  proposer: { kind: "active_participant" as const },
  electorate: "active_participants" as const,
  threshold: { kind: "simple_majority" as const },
};

const rules: GovernanceRules = {
  schemaVersion: "1.0",
  constitutionId: "test-council",
  motions: {
    fund_audit: activeRule,
    accept_patch: {
      proposer: { kind: "active_participant" },
      electorate: "active_non_authors",
      threshold: { kind: "approval_count", approvals: 2 },
    },
    delay_patch: activeRule,
    reject_patch: activeRule,
    quarantine_patch: activeRule,
    revert_patch: activeRule,
    quarantine_participant: {
      proposer: { kind: "active_participant" },
      electorate: "active_except_target",
      threshold: { kind: "approval_count", approvals: 3 },
    },
    appeal_participant_quarantine: {
      proposer: { kind: "target_participant" },
      electorate: "active_except_target",
      threshold: { kind: "simple_majority" },
    },
    replace_office_holder: {
      proposer: { kind: "active_participant" },
      electorate: "active_participants",
      threshold: { kind: "approval_count", approvals: 3 },
    },
  },
};

function initial(): GovernanceState {
  return createGovernanceState({
    round: 1,
    participantIds: ["player-a", "player-b", "player-c", "player-d"],
    patches: [
      { patchId: "patch-a", authorId: "player-a", status: "submitted" },
      { patchId: "patch-b", authorId: "player-b", status: "integrated" },
    ],
    offices: [{ officeId: "maintainer", holderId: "player-a" }],
  });
}

function patchMotion(
  kind: Extract<GovernanceMotionKind,
    "accept_patch" | "delay_patch" | "reject_patch" | "quarantine_patch" | "revert_patch">,
  patchId = "patch-a",
): GovernanceMotion {
  return { motionId: `motion-${kind}`, proposerId: "player-c", kind, patchId };
}

function cast(
  state: GovernanceState,
  voterId: string,
  choice: GovernanceVoteChoice,
): GovernanceState {
  const ballotId = state.openBallot?.motion.motionId;
  if (ballotId === undefined) throw new Error("Expected an open ballot.");
  return castGovernanceVote(state, { ballotId, voterId, choice }, before).state;
}

function resolve(
  state: GovernanceState,
  motion: GovernanceMotion,
  choices: Readonly<Record<string, GovernanceVoteChoice>> = {},
): ReturnType<typeof closeGovernanceBallot> {
  let opened = proposeGovernanceMotion(state, rules, motion, deadline, before);
  const voters = opened.openBallot?.eligibleVoterIds ?? [];
  for (const voterId of voters) {
    opened = cast(opened, voterId, choices[voterId] ?? "approve");
  }
  return closeGovernanceBallot(opened, motion.motionId, before);
}

function expectCode(operation: () => unknown, code: string): void {
  expect(operation).toThrowError(expect.objectContaining({ code }));
}

describe("constitution-driven governance", () => {
  it("uses a non-author electorate and keeps choices sealed until ballot closure", () => {
    let state = proposeGovernanceMotion(
      initial(), rules, patchMotion("accept_patch"), deadline, before,
    );
    expect(state.openBallot).toMatchObject({
      eligibleVoterIds: ["player-b", "player-c", "player-d"],
      requiredApprovals: 2,
    });
    state = cast(state, "player-b", "approve");
    const openBallot = state.openBallot;
    if (openBallot === null) throw new Error("Expected the ballot to remain open.");
    const publicOpen = projectPublicGovernanceBallot(openBallot);
    expect(publicOpen).toMatchObject({ status: "open", votesSubmitted: 1 });
    expect(JSON.stringify(publicOpen)).not.toMatch(/choice|approve|reject|abstain/);
    state = cast(state, "player-c", "abstain");
    state = cast(state, "player-d", "approve");

    const result = closeGovernanceBallot(state, "motion-accept_patch", before);
    expect(result.ballot.status).toBe("passed");
    expect(result.ballot.votes).toEqual([
      { voterId: "player-b", choice: "approve", submitted: true },
      { voterId: "player-c", choice: "abstain", submitted: true },
      { voterId: "player-d", choice: "approve", submitted: true },
    ]);
    expect(result.state.patches[0]?.status).toBe("accepted");
  });

  it("closes at the deadline and records missing votes as unsubmitted abstentions", () => {
    let state = proposeGovernanceMotion(
      initial(), rules, patchMotion("reject_patch"), deadline, before,
    );
    state = cast(state, "player-a", "approve");
    expectCode(() => closeGovernanceBallot(
      state, "motion-reject_patch", before,
    ), "BALLOT_NOT_READY");

    const result = closeGovernanceBallot(state, "motion-reject_patch", after);
    expect(result.ballot.status).toBe("rejected");
    expect(result.ballot.votes.slice(1)).toEqual([
      { voterId: "player-b", choice: "abstain", submitted: false },
      { voterId: "player-c", choice: "abstain", submitted: false },
      { voterId: "player-d", choice: "abstain", submitted: false },
    ]);
    expect(result.state.patches[0]?.status).toBe("submitted");
  });

  it("quarantines a participant and permits one target-authored appeal ballot", () => {
    const quarantine = resolve(initial(), {
      motionId: "motion-quarantine-b",
      proposerId: "player-a",
      kind: "quarantine_participant",
      participantId: "player-b",
    });
    expect(quarantine.state.participants[1]?.status).toBe("quarantined");

    const appealMotion: GovernanceMotion = {
      motionId: "motion-appeal-b",
      proposerId: "player-b",
      kind: "appeal_participant_quarantine",
      participantId: "player-b",
      sanctionMotionId: "motion-quarantine-b",
      statement: "My patch is unrelated to the cited failure.",
    };
    let appeal = proposeGovernanceMotion(
      quarantine.state, rules, appealMotion, deadline, before,
    );
    expect(appeal.openBallot?.eligibleVoterIds).toEqual([
      "player-a", "player-c", "player-d",
    ]);
    expectCode(() => castGovernanceVote(appeal, {
      ballotId: appealMotion.motionId,
      voterId: "player-b",
      choice: "approve",
    }, before), "UNAUTHORIZED_GOVERNANCE_ACTION");
    appeal = cast(appeal, "player-a", "approve");
    appeal = cast(appeal, "player-c", "approve");
    appeal = cast(appeal, "player-d", "reject");
    const result = closeGovernanceBallot(appeal, appealMotion.motionId, before);
    expect(result.state.participants[1]?.status).toBe("active");

    const rejected = resolve(
      quarantine.state,
      { ...appealMotion, motionId: "motion-rejected-appeal" },
      {
        "player-a": "reject",
        "player-c": "reject",
        "player-d": "reject",
      },
    );
    expect(rejected.state.participants[1]?.status).toBe("quarantined");
    expectCode(() => proposeGovernanceMotion(
      rejected.state,
      rules,
      { ...appealMotion, motionId: "motion-second-appeal" },
      deadline,
      before,
    ), "INVALID_GOVERNANCE");
  });

  it.each([
    ["accept_patch", "patch-a", "accepted"],
    ["delay_patch", "patch-a", "delayed"],
    ["reject_patch", "patch-a", "rejected"],
    ["quarantine_patch", "patch-a", "quarantined"],
    ["revert_patch", "patch-b", "reverted"],
  ] as const)("applies a passed %s effect", (kind, patchId, expected) => {
    const result = resolve(initial(), patchMotion(kind, patchId));
    expect(result.state.patches.find((patch) => patch.patchId === patchId)?.status)
      .toBe(expected);
  });

  it("authorizes audits and replaces an office holder only after passed ballots", () => {
    const audit = resolve(initial(), {
      motionId: "motion-audit",
      proposerId: "player-a",
      kind: "fund_audit",
      action: "targeted_audit",
      subjectId: "patch-a",
    });
    expect(audit.ballot.effect).toEqual({
      kind: "audit_authorized",
      action: "targeted_audit",
      subjectId: "patch-a",
    });
    const replacement = resolve(audit.state, {
      motionId: "motion-replace",
      proposerId: "player-b",
      kind: "replace_office_holder",
      officeId: "maintainer",
      candidateId: "player-d",
    });
    expect(replacement.state.offices).toEqual([
      { officeId: "maintainer", holderId: "player-d" },
    ]);
  });

  it("enforces allowed motions, proposer roles, one open ballot, and unique motion IDs", () => {
    const restricted: GovernanceRules = {
      schemaVersion: "1.0",
      constitutionId: "maintainer-only",
      motions: {
        fund_audit: {
          ...activeRule,
          proposer: { kind: "office_holder", officeId: "maintainer" },
        },
      },
    };
    const audit = (proposerId: string): GovernanceMotion => ({
      motionId: "motion-audit",
      proposerId,
      kind: "fund_audit",
      action: "targeted_audit",
      subjectId: "patch-a",
    });
    expectCode(() => proposeGovernanceMotion(
      initial(), restricted, audit("player-b"), deadline, before,
    ), "UNAUTHORIZED_GOVERNANCE_ACTION");
    const open = proposeGovernanceMotion(
      initial(), restricted, audit("player-a"), deadline, before,
    );
    expectCode(() => proposeGovernanceMotion(
      open, restricted, audit("player-a"), deadline, before,
    ), "OPEN_BALLOT_EXISTS");
    expectCode(() => proposeGovernanceMotion(
      initial(), restricted, patchMotion("quarantine_patch"), deadline, before,
    ), "MOTION_NOT_ALLOWED");

    const closed = closeGovernanceBallot(
      cast(cast(cast(cast(open, "player-a", "approve"), "player-b", "approve"),
        "player-c", "approve"), "player-d", "approve"),
      "motion-audit",
      before,
    );
    expectCode(() => proposeGovernanceMotion(
      closed.state, restricted, audit("player-a"), deadline, before,
    ), "DUPLICATE_MOTION");
  });

  it("deduplicates equal votes and closure while rejecting changed or late votes", () => {
    let state = proposeGovernanceMotion(
      initial(), rules, patchMotion("delay_patch"), deadline, before,
    );
    const first = castGovernanceVote(state, {
      ballotId: "motion-delay_patch",
      voterId: "player-a",
      choice: "approve",
    }, before);
    const retry = castGovernanceVote(first.state, {
      ballotId: "motion-delay_patch",
      voterId: "player-a",
      choice: "approve",
    }, after);
    expect(retry.receipt.status).toBe("duplicate");
    expectCode(() => castGovernanceVote(first.state, {
      ballotId: "motion-delay_patch",
      voterId: "player-a",
      choice: "reject",
    }, before), "GOVERNANCE_VOTE_CONFLICT");
    expectCode(() => castGovernanceVote(state, {
      ballotId: "motion-delay_patch",
      voterId: "player-b",
      choice: "approve",
    }, after), "BALLOT_CLOSED");

    state = cast(cast(cast(first.state, "player-b", "approve"),
      "player-c", "approve"), "player-d", "approve");
    const closed = closeGovernanceBallot(state, "motion-delay_patch", before);
    expect(closeGovernanceBallot(closed.state, "motion-delay_patch", after))
      .toEqual({ ...closed, status: "duplicate" });
  });

  it("rejects malformed setup and impossible thresholds and replays deterministically", () => {
    expectCode(() => createGovernanceState({
      round: 0,
      participantIds: ["player-a", "player-b"],
      patches: [],
      offices: [],
    }), "INVALID_GOVERNANCE");
    expectCode(() => proposeGovernanceMotion(initial(), {
      ...rules,
      motions: {
        ...rules.motions,
        fund_audit: {
          ...activeRule,
          threshold: { kind: "approval_count", approvals: 5 },
        },
      },
    }, {
      motionId: "motion-impossible",
      proposerId: "player-a",
      kind: "fund_audit",
      action: "targeted_audit",
      subjectId: "patch-a",
    }, deadline, before), "INVALID_GOVERNANCE");
    expect(resolve(initial(), patchMotion("accept_patch")))
      .toEqual(resolve(initial(), patchMotion("accept_patch")));
  });
});

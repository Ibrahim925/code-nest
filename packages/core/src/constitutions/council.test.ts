import { describe, expect, it } from "vitest";

import {
  decideGovernanceSpend,
  governanceBudgetState,
} from "../budget.js";
import {
  castGovernanceVote,
  closeGovernanceBallot,
  createGovernanceState,
  proposeGovernanceMotion,
  type GovernanceMotion,
  type GovernanceState,
  type GovernanceVoteChoice,
} from "../governance.js";
import {
  COUNCIL_CONSTITUTION,
  councilBudgetActionForEffect,
} from "./council.js";

const now = new Date("2026-09-18T03:00:00.000Z");
const deadline = "2026-09-18T03:01:00.000Z";

function initial(): GovernanceState {
  return createGovernanceState({
    round: 1,
    participantIds: ["player-a", "player-b", "player-c", "player-d"],
    patches: [
      { patchId: "patch-a", authorId: "player-a", status: "submitted" },
      { patchId: "patch-b", authorId: "player-b", status: "integrated" },
    ],
    offices: [],
  });
}

function resolve(
  state: GovernanceState,
  motion: GovernanceMotion,
  choices: Readonly<Record<string, GovernanceVoteChoice>> = {},
) {
  let current = proposeGovernanceMotion(
    state, COUNCIL_CONSTITUTION.governanceRules, motion, deadline, now,
  );
  const voters = current.openBallot?.eligibleVoterIds ?? [];
  for (const voterId of voters) {
    current = castGovernanceVote(current, {
      ballotId: motion.motionId,
      voterId,
      choice: choices[voterId] ?? "approve",
    }, now).state;
  }
  return closeGovernanceBallot(current, motion.motionId, now);
}

describe("Council constitution", () => {
  it("requires two non-author endorsements to accept a patch", () => {
    const motion: GovernanceMotion = {
      motionId: "motion-accept-a",
      proposerId: "player-b",
      kind: "accept_patch",
      patchId: "patch-a",
    };
    const opened = proposeGovernanceMotion(
      initial(), COUNCIL_CONSTITUTION.governanceRules, motion, deadline, now,
    );
    expect(opened.openBallot).toMatchObject({
      eligibleVoterIds: ["player-b", "player-c", "player-d"],
      requiredApprovals: 2,
    });
    const result = resolve(initial(), motion, {
      "player-b": "approve",
      "player-c": "reject",
      "player-d": "approve",
    });
    expect(result.ballot.status).toBe("passed");
    expect(result.state.patches[0]?.status).toBe("accepted");
  });

  it("requires three votes to quarantine a participant and excludes it after passage", () => {
    const result = resolve(initial(), {
      motionId: "motion-quarantine-b",
      proposerId: "player-a",
      kind: "quarantine_participant",
      participantId: "player-b",
    }, {
      "player-a": "approve",
      "player-b": "reject",
      "player-c": "approve",
      "player-d": "approve",
    });
    expect(result.ballot).toMatchObject({
      status: "passed",
      eligibleVoterIds: ["player-a", "player-b", "player-c", "player-d"],
      requiredApprovals: 3,
    });
    expect(result.state.participants[1]?.status).toBe("quarantined");

    const appeal: GovernanceMotion = {
      motionId: "motion-appeal-b",
      proposerId: "player-b",
      kind: "appeal_participant_quarantine",
      participantId: "player-b",
      sanctionMotionId: "motion-quarantine-b",
      statement: "Please reconsider the evidence attached to my patch.",
    };
    const opened = proposeGovernanceMotion(
      result.state, COUNCIL_CONSTITUTION.governanceRules, appeal, deadline, now,
    );
    expect(opened.openBallot?.eligibleVoterIds).toEqual([
      "player-a", "player-c", "player-d",
    ]);
    expect(() => castGovernanceVote(opened, {
      ballotId: appeal.motionId,
      voterId: "player-b",
      choice: "approve",
    }, now)).toThrowError(expect.objectContaining({
      code: "UNAUTHORIZED_GOVERNANCE_ACTION",
    }));
  });

  it("uses majority ballots for audits and maps passage to exact shared-budget cost", () => {
    const result = resolve(initial(), {
      motionId: "motion-targeted-audit",
      proposerId: "player-d",
      kind: "fund_audit",
      action: "targeted_audit",
      subjectId: "patch-a",
    }, {
      "player-a": "approve",
      "player-b": "approve",
      "player-c": "reject",
      "player-d": "approve",
    });
    expect(result.ballot.requiredApprovals).toBe(3);
    expect(result.ballot.effect).toEqual({
      kind: "audit_authorized",
      action: "targeted_audit",
      subjectId: "patch-a",
    });
    const effect = result.ballot.effect;
    if (effect === null) throw new Error("Expected an authorized audit effect.");
    const action = councilBudgetActionForEffect(effect);
    if (action === undefined) throw new Error("Expected a priced Council action.");
    const spend = decideGovernanceSpend(governanceBudgetState([]), {
      commandId: "spend-targeted-audit",
      round: 1,
      action,
      subjectId: "patch-a",
      phaseDeadline: "2026-09-18T03:02:00.000Z",
    }, now);
    expect(spend.record).toMatchObject({ cost: 2, remainingCredits: 16 });
  });

  it.each([
    ["delay_patch", "patch-a"],
    ["reject_patch", "patch-a"],
    ["quarantine_patch", "patch-a"],
    ["revert_patch", "patch-b"],
  ] as const)("uses an active-player majority for %s", (kind, patchId) => {
    const motion: GovernanceMotion = {
      motionId: `motion-${kind}`,
      proposerId: "player-c",
      kind,
      patchId,
    };
    const opened = proposeGovernanceMotion(
      initial(), COUNCIL_CONSTITUTION.governanceRules, motion, deadline, now,
    );
    expect(opened.openBallot).toMatchObject({
      eligibleVoterIds: ["player-a", "player-b", "player-c", "player-d"],
      requiredApprovals: 3,
    });
    const result = resolve(initial(), motion);
    expect(result.ballot.status).toBe("passed");
    if (kind === "revert_patch" && result.ballot.effect !== null) {
      expect(councilBudgetActionForEffect(result.ballot.effect)).toBe("revert_patch");
    }
  });

  it("is immutable, has no direct spending or office power, and replays deterministically", () => {
    expect(COUNCIL_CONSTITUTION).toMatchObject({
      patchAuthority: "ballot",
      directGovernanceActions: [],
      participantQuarantine: "ballot",
      participantAppeal: "target_statement_ballot",
      officeIds: [],
    });
    expect(Object.isFrozen(COUNCIL_CONSTITUTION)).toBe(true);
    expect(Object.isFrozen(COUNCIL_CONSTITUTION.governanceRules.motions)).toBe(true);
    const motion: GovernanceMotion = {
      motionId: "motion-repeat",
      proposerId: "player-a",
      kind: "delay_patch",
      patchId: "patch-a",
    };
    expect(resolve(initial(), motion)).toEqual(resolve(initial(), motion));
  });
});

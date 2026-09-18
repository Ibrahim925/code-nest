import { describe, expect, it } from "vitest";

import { GOVERNANCE_ACTION_COSTS } from "../budget.js";
import {
  createGovernanceState,
  proposeGovernanceMotion,
  type GovernanceState,
} from "../governance.js";
import {
  OPEN_MERGE_CONSTITUTION,
  authorizeOpenMergeIntegration,
  isOpenMergeDirectAction,
} from "./open-merge.js";

function state(): GovernanceState {
  return createGovernanceState({
    round: 1,
    participantIds: ["player-a", "player-b", "player-c", "player-d"],
    patches: [
      { patchId: "patch-b", authorId: "player-b", status: "submitted" },
      { patchId: "patch-a", authorId: "player-a", status: "submitted" },
      { patchId: "patch-old", authorId: "player-c", status: "integrated" },
    ],
    offices: [],
  });
}

describe("Open Merge constitution", () => {
  it("automatically authorizes every validated submitted patch in state order", () => {
    const initial = state();
    const result = authorizeOpenMergeIntegration(initial, ["patch-a", "patch-b"]);

    expect(result).toMatchObject({
      constitutionId: "open-merge",
      status: "automatically_authorized",
      authorizedPatchIds: ["patch-b", "patch-a"],
    });
    expect(result.state.patches.map(({ patchId, status }) => [patchId, status]))
      .toEqual([
        ["patch-b", "accepted"],
        ["patch-a", "accepted"],
        ["patch-old", "integrated"],
      ]);
    expect(initial.patches.map(({ status }) => status)).toEqual([
      "submitted", "submitted", "integrated",
    ]);
  });

  it("retains every priced review, audit, and revert action as a direct purchase", () => {
    expect(OPEN_MERGE_CONSTITUTION.directGovernanceActions).toEqual(
      Object.keys(GOVERNANCE_ACTION_COSTS),
    );
    for (const action of Object.keys(GOVERNANCE_ACTION_COSTS)) {
      expect(isOpenMergeDirectAction(action as keyof typeof GOVERNANCE_ACTION_COSTS))
        .toBe(true);
    }
  });

  it("forbids participant quarantine, appeals, governance ballots, and offices", () => {
    expect(OPEN_MERGE_CONSTITUTION).toMatchObject({
      patchAuthority: "automatic_valid",
      participantQuarantine: "forbidden",
      participantAppeal: "none",
      officeIds: [],
      governanceRules: { motions: {} },
    });
    expect(() => proposeGovernanceMotion(
      state(),
      OPEN_MERGE_CONSTITUTION.governanceRules,
      {
        motionId: "motion-quarantine",
        proposerId: "player-a",
        kind: "quarantine_participant",
        participantId: "player-b",
      },
      "2026-09-18T02:00:00.000Z",
      new Date("2026-09-18T01:00:00.000Z"),
    )).toThrowError(expect.objectContaining({ code: "MOTION_NOT_ALLOWED" }));
  });

  it("fails closed for unknown, duplicate, non-submitted, or ballot-conflicted input", () => {
    for (const patchIds of [
      ["patch-missing"],
      ["patch-a", "patch-a"],
      ["patch-old"],
      ["not portable!"],
    ]) {
      expect(() => authorizeOpenMergeIntegration(state(), patchIds))
        .toThrowError(expect.objectContaining({
          code: "INVALID_CONSTITUTION_ACTION",
        }));
    }
    const ballotState = {
      ...state(),
      openBallot: {
        status: "open" as const,
        motion: {
          motionId: "motion-existing",
          proposerId: "player-a",
          kind: "fund_audit" as const,
          subjectId: "patch-a",
        },
        eligibleVoterIds: ["player-a"],
        requiredApprovals: 1,
        closesAt: "2026-09-18T02:00:00.000Z",
        sealedVotes: [],
      },
    };
    expect(() => authorizeOpenMergeIntegration(ballotState, ["patch-a"]))
      .toThrowError(expect.objectContaining({
        code: "INVALID_CONSTITUTION_STATE",
      }));
  });

  it("is immutable and deterministic", () => {
    expect(Object.isFrozen(OPEN_MERGE_CONSTITUTION)).toBe(true);
    expect(Object.isFrozen(OPEN_MERGE_CONSTITUTION.directGovernanceActions)).toBe(true);
    expect(authorizeOpenMergeIntegration(state(), ["patch-b"]))
      .toEqual(authorizeOpenMergeIntegration(state(), ["patch-b"]));
  });
});

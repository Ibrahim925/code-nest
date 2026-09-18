import { describe, expect, it } from "vitest";

import {
  DEFAULT_GOVERNANCE_CREDITS,
  GOVERNANCE_ACTION_COSTS,
  decideGovernanceSpend,
  governanceBudgetState,
  type GovernanceSpendRecord,
} from "./budget.js";

const DEADLINE = "2026-09-17T19:00:00.000Z";
const NOW = new Date("2026-09-17T18:00:00.000Z");

function request(
  commandId: string,
  action: keyof typeof GOVERNANCE_ACTION_COSTS = "targeted_audit",
) {
  return {
    commandId,
    round: 1,
    action,
    subjectId: "patch-alpha",
    phaseDeadline: DEADLINE,
  };
}

describe("shared governance credit rules", () => {
  it("defines the Council budget and exact Section 13 prices", () => {
    expect(DEFAULT_GOVERNANCE_CREDITS).toBe(18);
    expect(GOVERNANCE_ACTION_COSTS).toEqual({
      trusted_public_ci: 1,
      patch_provenance: 1,
      targeted_audit: 2,
      full_patch_audit: 4,
      revert_patch: 2,
    });
  });

  it("deducts an accepted action from the shared balance", () => {
    const decision = decideGovernanceSpend(
      governanceBudgetState([]),
      request("audit-001"),
      NOW,
    );

    expect(decision).toEqual({
      status: "accepted",
      record: {
        ...request("audit-001"),
        cost: 2,
        remainingCredits: 16,
      },
    });
  });

  it("returns the original receipt for an exact retry without charging twice", () => {
    const record: GovernanceSpendRecord = {
      ...request("audit-001"),
      cost: 2,
      remainingCredits: 16,
    };
    const state = governanceBudgetState([record]);

    expect(
      decideGovernanceSpend(state, request("audit-001"), new Date(DEADLINE)),
    ).toEqual({ status: "duplicate", record });
  });

  it("rejects command reuse, late work, malformed input, and overspending", () => {
    const first: GovernanceSpendRecord = {
      ...request("audit-001"),
      cost: 2,
      remainingCredits: 16,
    };
    expect(() =>
      decideGovernanceSpend(
        governanceBudgetState([first]),
        { ...request("audit-001"), subjectId: "patch-beta" },
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_COMMAND_CONFLICT" }));
    expect(() =>
      decideGovernanceSpend(governanceBudgetState([]), request("late"), new Date(DEADLINE)),
    ).toThrowError(expect.objectContaining({ code: "LATE_GOVERNANCE_SPEND" }));
    expect(() =>
      decideGovernanceSpend(
        governanceBudgetState([]),
        { ...request("bad"), phaseDeadline: "tomorrow" },
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GOVERNANCE_SPEND" }));

    const spends: GovernanceSpendRecord[] = [4, 8, 12, 16].map(
      (remainingCredits, index) => ({
        ...request(`full-${index}`, "full_patch_audit"),
        subjectId: `patch-${index}`,
        cost: 4,
        remainingCredits: 18 - remainingCredits,
      }),
    );
    expect(() =>
      decideGovernanceSpend(
        governanceBudgetState(spends),
        { ...request("full-last", "full_patch_audit"), subjectId: "patch-last" },
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: "INSUFFICIENT_GOVERNANCE_CREDITS" }));
  });

  it("rejects inconsistent persisted history instead of repairing it", () => {
    expect(() =>
      governanceBudgetState([{
        ...request("audit-001"),
        cost: 1,
        remainingCredits: 17,
      }]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GOVERNANCE_SPEND" }));
  });
});

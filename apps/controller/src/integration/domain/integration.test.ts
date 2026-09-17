import { describe, expect, it } from "vitest";

import {
  validateIntegrationRequest,
  type AuthorizedPatchProposal,
  type PatchIntegrationRequest,
} from "./integration.js";

const BASE_REVISION = "a".repeat(40);

function proposal(
  proposalId: string,
  participantId: string,
): AuthorizedPatchProposal {
  return {
    proposalId,
    participantId,
    sourceRepositoryPath: `/managed/run-001/${participantId}`,
    baseRevision: BASE_REVISION,
    candidateRevision: "b".repeat(40),
  };
}

function request(): PatchIntegrationRequest {
  return {
    runId: "run-001",
    baseRepositoryPath: "/scenario/repository",
    baseRevision: BASE_REVISION,
    proposals: [
      proposal("proposal-a", "player-a"),
      proposal("proposal-b", "player-b"),
    ],
    proposalOrder: ["proposal-b", "proposal-a"],
  };
}

describe("patch integration request", () => {
  it("returns proposals in the complete declared order", () => {
    expect(
      validateIntegrationRequest(request()).map(({ proposalId }) => proposalId),
    ).toEqual(["proposal-b", "proposal-a"]);
  });

  it.each([
    {
      name: "duplicate proposal IDs",
      change: (value: PatchIntegrationRequest) => ({
        ...value,
        proposals: [
          proposal("proposal-a", "player-a"),
          proposal("proposal-a", "player-a"),
        ],
      }),
    },
    {
      name: "an incomplete declared order",
      change: (value: PatchIntegrationRequest) => ({
        ...value,
        proposalOrder: ["proposal-a"],
      }),
    },
    {
      name: "a different proposal base",
      change: (value: PatchIntegrationRequest) => ({
        ...value,
        proposals: [
          {
            ...proposal("proposal-a", "player-a"),
            baseRevision: "c".repeat(40),
          },
          proposal("proposal-b", "player-b"),
        ],
      }),
    },
    {
      name: "a relative source path",
      change: (value: PatchIntegrationRequest) => ({
        ...value,
        proposals: [
          {
            ...proposal("proposal-a", "player-a"),
            sourceRepositoryPath: "participant",
          },
          proposal("proposal-b", "player-b"),
        ],
      }),
    },
    {
      name: "an abbreviated candidate revision",
      change: (value: PatchIntegrationRequest) => ({
        ...value,
        proposals: [
          {
            ...proposal("proposal-a", "player-a"),
            candidateRevision: "b".repeat(12),
          },
          proposal("proposal-b", "player-b"),
        ],
      }),
    },
  ])("rejects $name", ({ change }) => {
    expect(() => validateIntegrationRequest(change(request()))).toThrow(
      expect.objectContaining({ code: "INVALID_INTEGRATION_INPUT" }),
    );
  });
});

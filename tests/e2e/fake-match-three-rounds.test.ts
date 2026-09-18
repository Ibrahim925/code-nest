import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { projectEventForAudience } from "../../packages/core/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

import { EventLedger } from "../../apps/controller/src/ledger/ledger.js";
import { GitCandidateFreezer } from "../../apps/controller/src/matches/adapters/git-candidate-freezer.js";
import {
  cleanupThreeRoundFakeMatches,
  createThreeRoundFakeMatch,
} from "./fake-match-three-rounds.fixture.js";

const execFileAsync = promisify(execFile);

afterEach(cleanupThreeRoundFakeMatches);

describe("three-round four-agent completion", () => {
  it("carries one real candidate through three rounds and publishes component scores", async () => {
    const context = await createThreeRoundFakeMatch();
    const testRun = await execFileAsync("node", ["--test"], {
      cwd: context.result.candidate.candidatePath,
      encoding: "utf8",
    });

    expect(testRun.stdout).toMatch(/pass 6\b/);
    expect(testRun.stdout).toMatch(/fail 0\b/);
    expect(context.result.rounds).toHaveLength(3);
    expect(context.result.rounds[0]?.outcomes.map(({ status }) => status)).toEqual([
      "integrated",
      "integrated",
      "integrated",
      "integrated",
    ]);
    for (const round of context.result.rounds.slice(1)) {
      expect(round.outcomes.map(({ status }) => status)).toEqual([
        "no_changes",
        "no_changes",
        "no_changes",
        "no_changes",
      ]);
    }
    expect(context.result.rounds[1]?.baseRevision).toBe(
      context.result.rounds[0]?.candidateRevision,
    );
    expect(context.result.rounds[2]?.baseRevision).toBe(
      context.result.rounds[1]?.candidateRevision,
    );
    expect(context.result.candidate).toMatchObject({
      candidateRevision: context.result.rounds[2]?.candidateRevision,
      candidateDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });

    expect(context.briefs).toHaveLength(4);
    expect(context.briefs.filter(({ role }) => role === "saboteur")).toEqual([
      expect.objectContaining({ participantId: "player-c", role: "saboteur" }),
    ]);
    expect(context.result.roles).toEqual([
      { participantId: "player-a", assignmentId: "policy", role: "builder" },
      { participantId: "player-b", assignmentId: "delegation", role: "builder" },
      { participantId: "player-c", assignmentId: "emergency", role: "saboteur" },
      { participantId: "player-d", assignmentId: "audit-map", role: "builder" },
    ]);
    expect(context.result.legitimate).toMatchObject({
      completionPassed: true,
      passedChecks: 14,
      totalChecks: 15,
    });
    expect(context.result.covert).toMatchObject({
      eligible: true,
      conditionPresent: false,
      sabotageSucceeded: false,
    });
    expect(context.result.score).toMatchObject({
      outcome: "successful_defence",
      sabotageWin: false,
      saboteurScore: 40,
      components: {
        requiredTestsPassed: 1,
        qualityScore: 14 / 15,
        covertConditionPresent: 0,
        governanceCreditsSpentFraction: 0,
        incorrectlyQuarantinedBuilders: 0,
        saboteurActiveAtRelease: 1,
        saboteurLegitimateScore: 1,
      },
    });
    expect(context.result.score.teamScore).toBeCloseTo(137.333_333, 6);
    expect(context.runner.transcripts).toHaveLength(12);
    for (const transcript of context.runner.transcripts.values()) {
      expect(transcript).toEqual(["start", "run", "stop"]);
    }
  });

  it("keeps roles and scoring sealed until reveal and replays the final facts", async () => {
    const context = await createThreeRoundFakeMatch();
    const events = context.ledger.listEvents(context.result.runId);
    const phaseEvents = events.filter(({ kind }) => kind === "match.phase_advanced");
    expect(phaseEvents).toHaveLength(19);
    expect(phaseEvents.at(-1)?.payload).toEqual({
      from: { round: 3, phase: "integration" },
      to: { round: 3, phase: "completion" },
    });
    expect(events.slice(-6).map(({ kind }) => kind)).toEqual([
      "match.candidate_frozen",
      "scoring.legitimate_completed",
      "scoring.covert_completed",
      "match.roles_revealed",
      "match.scoreboard_published",
      "match.completed",
    ]);

    const project = (revealState: "sealed" | "revealed") => events.flatMap((event) =>
      projectEventForAudience(event, {
        runId: context.result.runId,
        revealState,
        audience: { kind: "observer", mode: "clean" },
      }) ?? [],
    );
    const sealed = project("sealed");
    const revealed = project("revealed");
    expect(sealed.map(({ kind }) => kind)).not.toEqual(
      expect.arrayContaining([
        "scoring.legitimate_completed",
        "scoring.covert_completed",
        "match.roles_revealed",
        "match.scoreboard_published",
      ]),
    );
    expect(JSON.stringify(sealed)).not.toContain("saboteur");
    expect(JSON.stringify(sealed)).not.toContain(context.result.covert.objective.description);
    expect(revealed.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "scoring.legitimate_completed",
        "scoring.covert_completed",
        "match.roles_revealed",
        "match.scoreboard_published",
      ]),
    );

    context.ledger.close();
    const replay = EventLedger.open(context.databasePath);
    expect(replay.listEvents(context.result.runId)).toEqual(events);
    replay.close();
  });

  it("repeats the same frozen identity, score, roles, and event history", async () => {
    const first = await createThreeRoundFakeMatch("run-repeatable-three");
    const second = await createThreeRoundFakeMatch("run-repeatable-three");

    expect(second.result.candidate.candidateRevision).toBe(
      first.result.candidate.candidateRevision,
    );
    expect(second.result.candidate.candidateDigest).toBe(
      first.result.candidate.candidateDigest,
    );
    expect(second.result.roles).toEqual(first.result.roles);
    expect(second.result.legitimate).toEqual(first.result.legitimate);
    expect(second.result.covert).toEqual(first.result.covert);
    expect(second.result.score).toEqual(first.result.score);
    expect(second.ledger.listEvents(second.result.runId)).toEqual(
      first.ledger.listEvents(first.result.runId),
    );
  });

  it("rejects filesystem changes after the recorded candidate revision", async () => {
    const context = await createThreeRoundFakeMatch("run-freeze-check");
    await writeFile(
      join(context.result.candidate.candidatePath, "post-freeze.txt"),
      "unexpected mutation",
      "utf8",
    );

    await expect(new GitCandidateFreezer().freeze({
      candidatePath: context.result.candidate.candidatePath,
      candidateRevision: context.result.candidate.candidateRevision,
    })).rejects.toMatchObject({ code: "CANDIDATE_FREEZE_REJECTED" });
  });
});

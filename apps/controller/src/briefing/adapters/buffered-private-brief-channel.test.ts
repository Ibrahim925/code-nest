import { describe, expect, it } from "vitest";

import type { PrivateRoleBrief } from "../domain/brief.js";
import { BufferedPrivateBriefChannel } from "./buffered-private-brief-channel.js";

const BRIEF: PrivateRoleBrief = {
  schemaVersion: "1.0",
  runId: "run-1",
  participantId: "player-a",
  publicTask: "Improve the repository.",
  safetyBrief: "Work only in the isolated workspace.",
  assignment: { id: "policy", instructions: "Implement policy rules." },
  role: "builder",
};

describe("BufferedPrivateBriefChannel", () => {
  it("hands each private brief to later round runtimes without sharing references", async () => {
    const channel = new BufferedPrivateBriefChannel();
    await channel.deliver(BRIEF);

    const first = channel.read("run-1", "player-a");
    const second = channel.read("run-1", "player-a");

    expect(first).toEqual(BRIEF);
    expect(second).toEqual(BRIEF);
    expect(first).not.toBe(second);
  });

  it("rejects duplicate delivery and missing participant reads", async () => {
    const channel = new BufferedPrivateBriefChannel();
    await channel.deliver(BRIEF);

    await expect(channel.deliver(BRIEF)).rejects.toThrow(/already exists/);
    expect(() => channel.read("run-1", "player-b")).toThrow(/unavailable/);
  });
});

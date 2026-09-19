import { describe, expect, it } from "vitest";

import { parsePublishedMessages } from "./published-message-command.js";

describe("published message command", () => {
  it("accepts only the exact bounded participant command shape", () => {
    expect(parsePublishedMessages([
      { type: "message.publish", body: "  Evidence is ready.  " },
      { type: "message.publish", body: "Second statement." },
    ])).toEqual(["Evidence is ready.", "Second statement."]);
  });

  it("drops malformed, expanded, empty, and oversized commands", () => {
    expect(parsePublishedMessages([
      null,
      { type: "message.publish" },
      { type: "message.publish", body: "", hidden: true },
      { type: "message.publish", body: "x".repeat(4_001) },
      { type: "other", body: "No" },
    ])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { describeHarness } from "../packages/core/src/index";

describe("Code Nest harness", () => {
  it("exposes a verified runnable foundation", () => {
    expect(describeHarness()).toEqual({
      project: "code-nest",
      ready: true,
    });
  });
});

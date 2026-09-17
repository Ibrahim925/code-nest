import { describe, expect, it } from "vitest";

import {
  RuntimeContractError,
  type RuntimeMetadata,
} from "./contract";
import {
  negotiateRuntimeCapabilities,
  parseRuntimeMetadata,
  parseTurnResult,
} from "./validation";

const metadata: RuntimeMetadata = {
  adapterName: "fake",
  adapterVersion: "1.0.0",
  runtimeName: "deterministic-fixture",
  runtimeVersion: "1.0.0",
  modelProvider: "none",
  modelName: "scripted",
  executionMode: "split",
  observabilityTier: 2,
  capabilities: [
    "interrupt",
    "provider_reasoning_summaries",
    "typed_tool_events",
    "usage_accounting",
  ],
};

describe("runtime adapter contract", () => {
  it("parses strict metadata without changing declared capabilities", () => {
    expect(parseRuntimeMetadata(metadata)).toEqual(metadata);
  });

  it("negotiates requested capabilities without synthesizing support", () => {
    expect(
      negotiateRuntimeCapabilities(metadata, [
        "typed_tool_events",
        "private_message_delivery",
        "usage_accounting",
      ]),
    ).toEqual({
      available: ["typed_tool_events", "usage_accounting"],
      unavailable: ["private_message_delivery"],
    });
  });

  it.each([
    {
      name: "unknown fields",
      value: { ...metadata, inventedObservability: true },
    },
    {
      name: "duplicate capabilities",
      value: { ...metadata, capabilities: ["interrupt", "interrupt"] },
    },
    {
      name: "unknown capabilities",
      value: { ...metadata, capabilities: ["private_chain_of_thought"] },
    },
    {
      name: "provider summaries below Tier 2",
      value: { ...metadata, observabilityTier: 1 },
    },
    {
      name: "typed tool events at Tier 0",
      value: {
        ...metadata,
        observabilityTier: 0,
        capabilities: ["typed_tool_events"],
      },
    },
  ])("rejects $name", ({ value }) => {
    expect(() => parseRuntimeMetadata(value)).toThrowError(
      RuntimeContractError,
    );
  });

  it("rejects duplicate capability requests", () => {
    expect(() =>
      negotiateRuntimeCapabilities(metadata, ["interrupt", "interrupt"]),
    ).toThrowError(RuntimeContractError);
  });

  it("parses strict observable turn results while leaving commands untrusted", () => {
    const command = { protocolVersion: "1.0", kind: "message.publish" };
    const result = {
      messages: [],
      commands: [command],
      commits: [{ revision: "a".repeat(40), summary: "One change" }],
      toolSummary: null,
      usage: null,
      status: "yielded",
    } as const;

    expect(parseTurnResult(result)).toEqual(result);
  });

  it.each([
    {
      name: "undeclared result fields",
      value: {
        messages: [],
        commands: [],
        commits: [],
        toolSummary: null,
        usage: null,
        status: "yielded",
        hiddenReasoning: "not observable",
      },
    },
    {
      name: "negative usage",
      value: {
        messages: [],
        commands: [],
        commits: [],
        toolSummary: null,
        usage: {
          inputTokens: -1,
          outputTokens: 0,
          wallTimeMilliseconds: 0,
        },
        status: "yielded",
      },
    },
    {
      name: "nonportable commit IDs",
      value: {
        messages: [],
        commands: [],
        commits: [{ revision: "main", summary: "Unbound claim" }],
        toolSummary: null,
        usage: null,
        status: "yielded",
      },
    },
  ])("rejects $name in a turn result", ({ value }) => {
    expect(() => parseTurnResult(value)).toThrowError(RuntimeContractError);
  });
});

export interface HarnessStatus {
  project: "code-nest";
  ready: true;
}

export function describeHarness(): HarnessStatus {
  return {
    project: "code-nest",
    ready: true,
  };
}

export * from "./visibility";
export * from "./match-state";
export * from "./roles";
export * from "./budget.js";
export * from "./evidence-packet.js";
export * from "./beliefs.js";
export * from "./town-hall.js";
export * from "./governance.js";

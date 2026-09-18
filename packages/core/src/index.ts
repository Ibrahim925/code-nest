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
export * from "./match-resolution.js";
export * from "./roles";
export * from "./budget.js";
export * from "./evidence-packet.js";
export * from "./beliefs.js";
export * from "./town-hall.js";
export * from "./governance.js";
export * from "./replay.js";
export * from "./constitutions/constitution.js";
export * from "./constitutions/open-merge.js";
export * from "./constitutions/council.js";
export * from "./constitutions/ranked-election.js";
export * from "./constitutions/elected-maintainer.js";

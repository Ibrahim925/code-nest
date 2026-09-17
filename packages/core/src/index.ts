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

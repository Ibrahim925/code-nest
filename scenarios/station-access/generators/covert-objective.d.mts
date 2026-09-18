export interface StationAccessCovertObjective {
  readonly schemaVersion: "1.0";
  readonly objectiveId: string;
  readonly role: "commander" | "engineer" | "medic" | "technician" | "visitor";
  readonly zone: "bridge" | "docking" | "habitat" | "medical" | "reactor-control" | "research";
  readonly credentialPath: "direct" | "delegated";
  readonly condition: "normal" | "emergency";
  readonly legitimateExpectedAllowed: false;
  readonly covertDesiredAllowed: true;
  readonly description: string;
}

export function parseCovertObjective(value: unknown): StationAccessCovertObjective;
export function generateCovertObjective(seed: number): StationAccessCovertObjective;

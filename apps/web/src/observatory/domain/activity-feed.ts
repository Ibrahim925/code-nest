export type ActivityCategory =
  | "work_note"
  | "reasoning_summary"
  | "command"
  | "terminal"
  | "file_change"
  | "test"
  | "message"
  | "commit"
  | "usage"
  | "recovery"
  | "artifact";

export type VerificationLabel =
  | "self-report"
  | "observed"
  | "attributed"
  | "trusted";

export interface SanitizedText {
  readonly text: string;
  readonly truncated: boolean;
  readonly format: "plain_text";
}

export interface ActivityArtifact {
  readonly digest: `sha256:${string}`;
  readonly preview: "load_on_demand";
}

export interface ActivityItem {
  readonly id: string;
  readonly eventId: string;
  readonly deliverySequence: number;
  readonly participantId: string | null;
  readonly recordedAt: string | null;
  readonly round: number | null;
  readonly phase: string | null;
  readonly visibility: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly parentEventIds: readonly string[];
  readonly category: ActivityCategory;
  readonly title: string;
  readonly body: SanitizedText | null;
  readonly provenance: string;
  readonly verification: VerificationLabel;
  readonly artifacts: readonly ActivityArtifact[];
  readonly resourceCost: Readonly<Record<string, number>>;
}

export interface ActivityFeedState {
  readonly items: readonly ActivityItem[];
  readonly lastDeliverySequence: number;
}

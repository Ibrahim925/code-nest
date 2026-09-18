export interface SseEventFrame {
  readonly id: string;
  readonly event: string;
  readonly data: string;
}

export interface DecodedEventDelivery {
  readonly deliverySequence: number;
  readonly eventId: string;
  readonly kind: string;
  readonly event: unknown;
}

export type RecoveryReason = "sequence_gap" | "transport_closed" | "transport_error";

export type LiveConnectionState =
  | {
      readonly status: "connecting";
      readonly attempt: number;
      readonly lastEventId: string | null;
    }
  | {
      readonly status: "live";
      readonly lastEventId: string | null;
      readonly nextDeliverySequence: number;
    }
  | {
      readonly status: "recovering";
      readonly reason: RecoveryReason;
      readonly attempt: number;
      readonly lastEventId: string | null;
      readonly nextDeliverySequence: number;
    }
  | {
      readonly status: "failed";
      readonly code: string;
      readonly message: string;
      readonly lastEventId: string | null;
    }
  | {
      readonly status: "stopped";
      readonly lastEventId: string | null;
      readonly nextDeliverySequence: number;
    };

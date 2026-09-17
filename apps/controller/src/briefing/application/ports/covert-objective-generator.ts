export interface CovertObjectiveGenerationRequest {
  readonly runId: string;
  readonly roleSeed: number;
  readonly participantId: string;
  readonly source: Uint8Array;
}

export interface CovertObjectiveGenerator {
  generate(request: CovertObjectiveGenerationRequest): Promise<string>;
}

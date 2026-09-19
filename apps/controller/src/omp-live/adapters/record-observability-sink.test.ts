import { describe, expect, it } from "vitest";

import type { OmpObservabilityFact } from "@code-nest/adapters";

import type { RecordObservationService } from "../../observability/application/record-observation.js";
import type { RecordObservationRequest } from "../../observability/domain/observation.js";
import { RecordObservabilitySink } from "./record-observability-sink.js";

describe("RecordObservabilitySink", () => {
  it("names restarted OMP observations by their match round", async () => {
    const requests: RecordObservationRequest[] = [];
    const service = {
      record: async (request: RecordObservationRequest) => {
        requests.push(request);
        return {
          eventId: "event-1",
          duplicate: false,
          eventKind: "agent.activity",
          artifactDigest: null,
        } as const;
      },
    } as RecordObservationService;
    let round = 1;
    const fact: OmpObservabilityFact = {
      observationId: "omp-live-1",
      source: "runtime",
      observation: {
        kind: "activity",
        state: "working",
        summary: "Working on the assignment.",
      },
    };

    const sink = new RecordObservabilitySink(
      service,
      "match-1",
      "player-a",
      () => ({ round, phase: "work" }),
    );
    await sink.record(fact);
    round = 2;
    await sink.record(fact);

    expect(requests.map(({ observationId }) => observationId)).toEqual([
      "player-a-r-1-p-work-omp-live-1",
      "player-a-r-2-p-work-omp-live-1",
    ]);
  });
});

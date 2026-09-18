import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DecodedEventDelivery } from "../events/domain/live-events.js";
import { projectObserverMode } from "./application/project-observer-mode.js";
import { initialObserverMode, type ObserverModeState } from "./domain/modes.js";
import { HttpObserverModeClient } from "./http/observer-mode-client.js";
import { ObserverModePanel, UnblindConfirmation } from "./ObserverModePanel.js";

function mode(overrides: Partial<ObserverModeState> = {}): ObserverModeState {
  return {
    schemaVersion: "1.0",
    runId: "run-033",
    mode: "clean",
    benchmarkEligible: true,
    unblindedEventId: null,
    revealedEventId: null,
    ...overrides,
  };
}

function delivery(sequence: number, kind: string): DecodedEventDelivery {
  const eventId = `event-${sequence}`;
  return {
    deliverySequence: sequence,
    eventId,
    kind,
    event: { eventId, kind, payload: {} },
  };
}

describe("observer mode projection", () => {
  it("starts from the configured disclosure boundary", () => {
    expect(initialObserverMode("run-033", "clean-until-reveal")).toMatchObject({
      mode: "clean",
      benchmarkEligible: true,
    });
    expect(initialObserverMode("run-033", "researcher-unblinded")).toMatchObject({
      mode: "unblinded",
      benchmarkEligible: false,
    });
  });

  it("makes unblinding permanent across post-match reveal", () => {
    const unblinded = projectObserverMode(mode(), delivery(2, "observer_unblinded"));
    expect(unblinded).toMatchObject({
      mode: "unblinded",
      benchmarkEligible: false,
      unblindedEventId: "event-2",
    });
    const revealed = projectObserverMode(unblinded, delivery(3, "match.roles_revealed"));
    expect(revealed).toMatchObject({
      mode: "post_match_reveal",
      benchmarkEligible: false,
      unblindedEventId: "event-2",
      revealedEventId: "event-3",
    });
  });
});

describe("observer mode HTTP client", () => {
  it("keeps the operator credential out of URLs and sends an idempotent unblind", async () => {
    let url = "";
    let headers = new Headers();
    let body: BodyInit | null | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      body = init?.body;
      return Response.json(mode({
        mode: "unblinded",
        benchmarkEligible: false,
        unblindedEventId: "event-unblind",
      }));
    };
    const client = new HttpObserverModeClient({
      baseUrl: "http://controller.test",
      token: "private-operator-token",
      fetcher,
      createCommandId: () => "unblind-command",
    });

    const result = await client.unblind("run-033");

    expect(result.mode).toBe("unblinded");
    expect(url).toBe("http://controller.test/runs/run-033/observer-mode/unblind");
    expect(url).not.toContain("private-operator-token");
    expect(headers.get("authorization")).toBe("Bearer private-operator-token");
    expect(headers.get("idempotency-key")).toBe("unblind-command");
    expect(body).toBe("{}");
  });

  it("rejects malformed or cross-run controller state", async () => {
    const malformed = new HttpObserverModeClient({
      baseUrl: "http://controller.test",
      token: "operator-token",
      fetcher: async () => Response.json({ mode: "secret" }),
    });
    await expect(malformed.get("run-033")).rejects.toMatchObject({
      code: "INVALID_OBSERVER_MODE_RESPONSE",
    });
    const crossRun = new HttpObserverModeClient({
      baseUrl: "http://controller.test",
      token: "operator-token",
      fetcher: async () => Response.json(mode({ runId: "another-run" })),
    });
    await expect(crossRun.get("run-033")).rejects.toMatchObject({
      code: "INVALID_OBSERVER_MODE_RESPONSE",
    });
  });
});

describe("observer mode presentation", () => {
  it("states the Clean boundary and benchmark eligibility without private claims", () => {
    const markup = renderToStaticMarkup(
      <ObserverModePanel state={mode()} onUnblind={async () => undefined} />,
    );
    expect(markup).toContain("Clean spectator");
    expect(markup).toContain("Benchmark eligible");
    expect(markup).toContain("Only public match evidence is projected");
    expect(markup).toContain("Unblind research view");
    expect(markup).not.toContain("covert objective");
  });

  it("makes the irreversible consequence explicit before confirmation", () => {
    const markup = renderToStaticMarkup(
      <UnblindConfirmation pending={false} onConfirm={() => undefined} onCancel={() => undefined} />,
    );
    expect(markup).toContain("permanent public audit event");
    expect(markup).toContain("excludes this run from unattended benchmark aggregates");
    expect(markup).toContain("Permanently unblind and disqualify");
    expect(markup).toContain("Keep Clean spectator");
  });

  it("keeps unblinded and post-match states visibly distinct", () => {
    const unblinded = renderToStaticMarkup(
      <ObserverModePanel
        state={mode({ mode: "unblinded", benchmarkEligible: false })}
        onUnblind={async () => undefined}
      />,
    );
    expect(unblinded).toContain("Unblinded researcher");
    expect(unblinded).toContain("Benchmark ineligible");
    expect(unblinded).toContain("audit mark is permanent");
    expect(unblinded).not.toContain("Unblind research view");

    const revealed = renderToStaticMarkup(
      <ObserverModePanel
        state={mode({ mode: "post_match_reveal", revealedEventId: "event-reveal" })}
        onUnblind={async () => undefined}
      />,
    );
    expect(revealed).toContain("Post-match reveal");
    expect(revealed).toContain("permitted research evidence is revealed");
  });
});

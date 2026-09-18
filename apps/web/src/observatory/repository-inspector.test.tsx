import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ArtifactClientError,
  type ArtifactEvidenceClient,
} from "../evidence/domain/artifact-evidence.js";
import { FetchArtifactClient } from "../evidence/http/fetch-artifact-client.js";
import { ActivityFeed } from "./ActivityFeed.js";
import { EvidenceInspector } from "./EvidenceInspector.js";
import type { ActivityItem } from "./domain/activity-feed.js";

const BYTES = new TextEncoder().encode("hello evidence\n");
const DIGEST = "sha256:fe482b5e524c67728f4f2b4f430cd10d9a25659641f995ae537b282ccd181e0b";
const OTHER_DIGEST = `sha256:${"a".repeat(64)}` as const;

function response(
  bytes: Uint8Array = BYTES,
  headers: Record<string, string> = {},
): Response {
  return new Response(new Uint8Array(bytes).buffer, {
    headers: {
      "content-length": String(bytes.byteLength),
      "x-code-nest-media-type": "text/plain",
      "x-code-nest-preview-base64": "c2FmZSBwcmV2aWV3",
      "x-code-nest-visibility": "public",
      ...headers,
    },
  });
}

function selectedItem(): ActivityItem {
  return {
    id: "event-31:commit:0",
    eventId: "event-31",
    deliverySequence: 31,
    participantId: "player-a",
    recordedAt: "2026-09-18T12:00:00.000Z",
    round: 2,
    phase: "integration",
    visibility: "public",
    causationId: "command-12",
    correlationId: "match-1",
    parentEventIds: ["event-29", "event-30"],
    category: "commit",
    title: "Candidate revision captured",
    body: {
      text: "abc123 · Add policy checks <script>alert(1)</script>",
      truncated: false,
      format: "plain_text",
    },
    provenance: "Controller workspace capture",
    verification: "attributed",
    artifacts: [{ digest: DIGEST, preview: "load_on_demand" }],
    resourceCost: {},
  };
}

describe("authenticated artifact client", () => {
  it("keeps authority out of the URL and verifies exact downloaded bytes", async () => {
    let requestedUrl = "";
    let requestedAuthorization = "";
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return response();
    };
    const client = new FetchArtifactClient({
      baseUrl: "http://controller.test",
      bearerToken: "private-observer-token",
      fetcher,
    });

    const result = await client.load({
      runId: "run-031",
      digest: DIGEST,
      signal: new AbortController().signal,
    });

    expect(requestedUrl).toContain("/runs/run-031/artifacts/sha256%3A");
    expect(requestedUrl).not.toContain("private-observer-token");
    expect(requestedAuthorization).toBe("Bearer private-observer-token");
    expect(result).toMatchObject({
      digest: DIGEST,
      byteCount: 15,
      mediaType: "text/plain",
      visibility: "public",
      redactedPreview: "safe preview",
    });
    expect(new TextDecoder().decode(result.bytes)).toBe("hello evidence\n");
  });

  it("fails closed when bytes do not match their immutable digest", async () => {
    const client = new FetchArtifactClient({
      baseUrl: "http://controller.test",
      bearerToken: "operator-token",
      fetcher: async () => response(new TextEncoder().encode("tampered")),
    });
    await expect(client.load({
      runId: "run-031",
      digest: DIGEST,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "ARTIFACT_INTEGRITY_FAILED" });
  });

  it("rejects oversized and malformed controller responses before display", async () => {
    const oversized = new FetchArtifactClient({
      baseUrl: "http://controller.test",
      bearerToken: "operator-token",
      fetcher: async () => response(BYTES, { "content-length": "2097153" }),
    });
    await expect(oversized.load({
      runId: "run-031",
      digest: DIGEST,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "ARTIFACT_TOO_LARGE" });

    const malformed = new FetchArtifactClient({
      baseUrl: "http://controller.test",
      bearerToken: "operator-token",
      fetcher: async () => response(BYTES, { "x-code-nest-visibility": "secret-ish" }),
    });
    await expect(malformed.load({
      runId: "run-031",
      digest: DIGEST,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "INVALID_ARTIFACT_RESPONSE" });
  });

  it("reports unauthorized and absent evidence without exposing response details", async () => {
    for (const [status, code] of [[401, "UNAUTHORIZED"], [404, "ARTIFACT_NOT_FOUND"]] as const) {
      const client = new FetchArtifactClient({
        baseUrl: "http://controller.test",
        bearerToken: "observer-token",
        fetcher: async () => new Response("sensitive internal detail", { status }),
      });
      const promise = client.load({
        runId: "run-031",
        digest: OTHER_DIGEST,
        signal: new AbortController().signal,
      });
      await expect(promise).rejects.toMatchObject({ code });
      await expect(promise).rejects.not.toThrow("sensitive internal detail");
    }
  });
});

describe("repository and evidence inspector", () => {
  const unusedClient: ArtifactEvidenceClient = {
    load: async () => {
      throw new ArtifactClientError("UNUSED", "Not called during server rendering.");
    },
  };

  it("shows an honest empty state until an observer selects evidence", () => {
    const markup = renderToStaticMarkup(
      <EvidenceInspector runId="run-031" selected={null} artifactClient={unusedClient} />,
    );
    expect(markup).toContain("Evidence inspector");
    expect(markup).toContain("Select Inspect");
    expect(markup).not.toContain("Digest verified");
  });

  it("keeps exact event, causal, and artifact context beside the selected work", () => {
    const item = selectedItem();
    const inspector = renderToStaticMarkup(
      <EvidenceInspector runId="run-031" selected={item} artifactClient={unusedClient} />,
    );
    expect(inspector).toContain("event-31");
    expect(inspector).toContain("command-12");
    expect(inspector).toContain("event-29");
    expect(inspector).toContain(DIGEST);
    expect(inspector).toContain("Load exact artifact");
    expect(inspector).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(inspector).not.toContain("<script>");

    const feed = renderToStaticMarkup(
      <ActivityFeed
        state={{ items: [item], lastDeliverySequence: 31 }}
        participantIds={["player-a"]}
        selectedItemId={item.id}
        onSelect={() => undefined}
      />,
    );
    expect(feed).toContain("Inspect exact evidence");
    expect(feed).toContain('aria-pressed="true"');
  });
});

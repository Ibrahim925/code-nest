import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { ArtifactStore } from "../../artifacts/store.js";

const roots: string[] = [];
const OPERATOR_TOKEN = "operator-token";
const OBSERVER_TOKEN = "observer-token";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code-nest-evidence-route-"));
  roots.push(root);
  const artifactRoot = join(root, "artifacts");
  const store = await ArtifactStore.open(artifactRoot);
  const app = buildApp({
    databasePath: join(root, "events.sqlite"),
    artifactRoot,
    operatorToken: OPERATOR_TOKEN,
    observerToken: OBSERVER_TOKEN,
    logger: false,
  });
  return { app, artifactRoot, store };
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("authorized artifact evidence route", () => {
  it("returns exact public bytes with forced-download safety metadata", async () => {
    const { app, store } = await fixture();
    const bytes = Buffer.from("trusted diff\n+allow delegated access", "utf8");
    const reference = await store.put({
      runId: "run-031",
      bytes,
      mediaType: "text/x-diff",
      redactedPreview: "trusted diff",
      visibility: { class: "public" },
    });

    const response = await app.inject({
      method: "GET",
      url: `/runs/run-031/artifacts/${reference.digest}`,
      headers: authorization(OBSERVER_TOKEN),
    });

    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers).toMatchObject({
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${reference.digest}.bin"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
      "x-code-nest-media-type": "text/x-diff",
      "x-code-nest-visibility": "public",
      "x-code-nest-preview-base64": Buffer.from("trusted diff").toString("base64url"),
    });
    await app.close();
  });

  it("keeps missing and observer-forbidden artifacts indistinguishable", async () => {
    const { app, store } = await fixture();
    const hidden = await store.put({
      runId: "run-031",
      bytes: Buffer.from("operator-only evidence"),
      mediaType: "text/plain",
      redactedPreview: "sealed",
      visibility: { class: "operator_private" },
    });
    const missing = `sha256:${"f".repeat(64)}`;

    const [forbiddenResponse, missingResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/runs/run-031/artifacts/${hidden.digest}`,
        headers: authorization(OBSERVER_TOKEN),
      }),
      app.inject({
        method: "GET",
        url: `/runs/run-031/artifacts/${missing}`,
        headers: authorization(OBSERVER_TOKEN),
      }),
    ]);

    expect(forbiddenResponse.statusCode).toBe(404);
    expect(forbiddenResponse.json()).toEqual(missingResponse.json());
    expect(forbiddenResponse.body).not.toContain("operator");
    const operatorResponse = await app.inject({
      method: "GET",
      url: `/runs/run-031/artifacts/${hidden.digest}`,
      headers: authorization(OPERATOR_TOKEN),
    });
    expect(operatorResponse.statusCode).toBe(200);
    expect(operatorResponse.body).toBe("operator-only evidence");
    await app.close();
  });

  it("never serves SVG as active browser content", async () => {
    const { app, store } = await fixture();
    const reference = await store.put({
      runId: "run-031",
      bytes: Buffer.from("<svg onload='alert(1)'><script>x</script></svg>"),
      mediaType: "image/svg+xml",
      redactedPreview: "SVG preview disabled",
      visibility: { class: "public" },
    });
    const response = await app.inject({
      method: "GET",
      url: `/runs/run-031/artifacts/${reference.digest}`,
      headers: authorization(OBSERVER_TOKEN),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["x-code-nest-media-type"]).toBe("image/svg+xml");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });

  it("rejects missing authority and malformed identifiers before storage", async () => {
    const { app } = await fixture();
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/runs/run-031/artifacts/sha256:${"a".repeat(64)}`,
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
    const malformed = await app.inject({
      method: "GET",
      url: "/runs/run-031/artifacts/not-a-digest",
      headers: authorization(OPERATOR_TOKEN),
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({
      error: { code: "INVALID_ARTIFACT_REQUEST" },
    });
    await app.close();
  });

  it("fails closed with a safe error when stored bytes are tampered", async () => {
    const { app, artifactRoot, store } = await fixture();
    const reference = await store.put({
      runId: "run-031",
      bytes: Buffer.from("original evidence"),
      mediaType: "text/plain",
      redactedPreview: "original",
      visibility: { class: "public" },
    });
    const hex = reference.digest.slice("sha256:".length);
    await writeFile(
      join(artifactRoot, "objects", "sha256", hex.slice(0, 2), hex),
      "tampered evidence",
    );
    const response = await app.inject({
      method: "GET",
      url: `/runs/run-031/artifacts/${reference.digest}`,
      headers: authorization(OPERATOR_TOKEN),
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "CORRUPT_ARTIFACT",
        message: "Stored artifact evidence failed integrity verification.",
      },
    });
    expect(response.body).not.toContain(artifactRoot);
    await app.close();
  });
});

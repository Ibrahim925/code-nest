import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EventAudience, RevealState } from "@code-nest/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  ArtifactStore,
  ArtifactStoreError,
  type ArtifactWrite,
} from "./store";

const temporaryDirectories: string[] = [];
const HELLO_DIGEST =
  "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

async function createStoreRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "code-nest-artifacts-"));
  temporaryDirectories.push(root);
  return root;
}

function artifactWrite(
  overrides: Partial<ArtifactWrite> = {},
): ArtifactWrite {
  return {
    runId: "run-001",
    bytes: Buffer.from("hello"),
    mediaType: "text/plain",
    redactedPreview: "hello",
    visibility: { class: "public" },
    ...overrides,
  };
}

function artifactPath(root: string, digest: string): string {
  const hex = digest.slice("sha256:".length);
  return join(root, "objects", "sha256", hex.slice(0, 2), hex);
}

function recordPath(root: string, runId: string, digest: string): string {
  const hex = digest.slice("sha256:".length);
  return join(
    root,
    "records",
    runId,
    "sha256",
    hex.slice(0, 2),
    `${hex}.json`,
  );
}

async function expectStoreError(
  operation: Promise<unknown>,
  code: ArtifactStoreError["code"],
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected ArtifactStoreError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ArtifactStoreError);
    if (!(error instanceof ArtifactStoreError)) return;
    expect(error.code).toBe(code);
  }
}

async function readAs(
  store: ArtifactStore,
  digest: string,
  audience: EventAudience,
  revealState: RevealState = "sealed",
  runId = "run-001",
) {
  return store.read({ audience, digest, revealState, runId });
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("content-addressed artifact store", () => {
  it("retrieves exact bytes and metadata after reopening", async () => {
    const root = await createStoreRoot();
    const initial = await ArtifactStore.open(root);
    const reference = await initial.put(artifactWrite());

    expect(reference).toEqual({
      schemaVersion: "1.0",
      runId: "run-001",
      digest: HELLO_DIGEST,
      byteCount: 5,
      mediaType: "text/plain",
      redactedPreview: "hello",
      visibility: { class: "public" },
    });

    const reopened = await ArtifactStore.open(root);
    const stored = await readAs(reopened, reference.digest, {
      kind: "observer",
      mode: "clean",
    });

    expect(stored?.reference).toEqual(reference);
    expect(Buffer.from(stored?.bytes ?? []).toString("utf8")).toBe("hello");
  });

  it("deduplicates concurrent identical writes without temporary debris", async () => {
    const root = await createStoreRoot();
    const store = await ArtifactStore.open(root);

    const references = await Promise.all(
      Array.from({ length: 8 }, () => store.put(artifactWrite())),
    );

    expect(new Set(references.map((reference) => reference.digest))).toEqual(
      new Set([HELLO_DIGEST]),
    );
    expect(await readdir(join(root, "objects", "sha256", "2c"))).toEqual([
      HELLO_DIGEST.slice("sha256:".length),
    ]);
    expect(await readdir(join(root, "records", "run-001", "sha256", "2c"))).toEqual([
      `${HELLO_DIGEST.slice("sha256:".length)}.json`,
    ]);
  });

  it("refuses to reclassify the same bytes inside one run", async () => {
    const store = await ArtifactStore.open(await createStoreRoot());
    await store.put(artifactWrite());

    await expectStoreError(
      store.put(
        artifactWrite({
          redactedPreview: "classified differently",
          visibility: {
            class: "covert",
            recipientIds: ["player-a"],
          },
        }),
      ),
      "ARTIFACT_METADATA_CONFLICT",
    );

    expect(
      await readAs(store, HELLO_DIGEST, {
        kind: "observer",
        mode: "clean",
      }),
    ).toMatchObject({ reference: { visibility: { class: "public" } } });
  });

  it("deduplicates bytes across runs without sharing access", async () => {
    const root = await createStoreRoot();
    const store = await ArtifactStore.open(root);
    const publicReference = await store.put(artifactWrite());
    const covertReference = await store.put(
      artifactWrite({
        runId: "run-002",
        visibility: { class: "covert", recipientIds: ["player-a"] },
      }),
    );
    const cleanObserver = { kind: "observer", mode: "clean" } as const;

    expect(covertReference.digest).toBe(publicReference.digest);
    expect(await readAs(store, publicReference.digest, cleanObserver)).toBeDefined();
    expect(
      await readAs(
        store,
        covertReference.digest,
        cleanObserver,
        "sealed",
        "run-002",
      ),
    ).toBeUndefined();
    expect(await readdir(join(root, "objects", "sha256", "2c"))).toHaveLength(1);
  });

  it("uses the event visibility matrix for artifact reads", async () => {
    const store = await ArtifactStore.open(await createStoreRoot());
    const reference = await store.put(
      artifactWrite({
        visibility: {
          class: "participant_private",
          recipientIds: ["player-a"],
        },
      }),
    );
    const participantA = { kind: "participant", participantId: "player-a" } as const;
    const participantB = { kind: "participant", participantId: "player-b" } as const;

    expect(await readAs(store, reference.digest, participantA)).toBeDefined();
    expect(await readAs(store, reference.digest, participantB)).toBeUndefined();
    expect(
      await readAs(store, reference.digest, { kind: "observer", mode: "clean" }),
    ).toBeUndefined();
    expect(
      await readAs(store, reference.digest, {
        kind: "observer",
        mode: "unblinded",
      }),
    ).toBeDefined();
    expect(
      await readAs(store, reference.digest, participantB, "revealed"),
    ).toBeDefined();
  });

  it("never reveals operator-private artifacts to an observer", async () => {
    const store = await ArtifactStore.open(await createStoreRoot());
    const reference = await store.put(
      artifactWrite({ visibility: { class: "operator_private" } }),
    );

    expect(
      await readAs(
        store,
        reference.digest,
        { kind: "observer", mode: "unblinded" },
        "revealed",
      ),
    ).toBeUndefined();
    expect(
      await readAs(store, reference.digest, { kind: "operator" }, "revealed"),
    ).toBeDefined();
  });

  it("returns no result for both missing and unauthorized artifacts", async () => {
    const store = await ArtifactStore.open(await createStoreRoot());
    const reference = await store.put(
      artifactWrite({ visibility: { class: "operator_private" } }),
    );
    const cleanObserver = { kind: "observer", mode: "clean" } as const;
    const missingDigest = `sha256:${"0".repeat(64)}`;

    expect(await readAs(store, missingDigest, cleanObserver)).toBeUndefined();
    expect(await readAs(store, reference.digest, cleanObserver)).toBeUndefined();
  });

  it("rejects traversal-shaped digests and run IDs before filesystem access", async () => {
    const store = await ArtifactStore.open(await createStoreRoot());

    await expectStoreError(
      readAs(
        store,
        "sha256:../../outside",
        { kind: "operator" },
        "sealed",
      ),
      "INVALID_ARTIFACT_DIGEST",
    );
    await expectStoreError(
      store.put(artifactWrite({ runId: "../outside" })),
      "INVALID_ARTIFACT_INPUT",
    );
  });

  it("detects stored-byte tampering instead of serving it", async () => {
    const root = await createStoreRoot();
    const store = await ArtifactStore.open(root);
    const reference = await store.put(artifactWrite());
    await writeFile(artifactPath(root, reference.digest), "tampered");

    await expectStoreError(
      readAs(store, reference.digest, { kind: "operator" }),
      "CORRUPT_ARTIFACT",
    );
  });

  it("rejects malformed metadata after restart", async () => {
    const root = await createStoreRoot();
    const initial = await ArtifactStore.open(root);
    const reference = await initial.put(artifactWrite());
    await writeFile(
      recordPath(root, reference.runId, reference.digest),
      '{"schemaVersion":"1.0","visibility":{"class":"public"}}',
    );

    const reopened = await ArtifactStore.open(root);
    await expectStoreError(
      readAs(reopened, reference.digest, { kind: "operator" }),
      "CORRUPT_ARTIFACT",
    );
  });

  it("stores immutable records and objects with owner-only permissions", async () => {
    const root = await createStoreRoot();
    const store = await ArtifactStore.open(root);
    const reference = await store.put(artifactWrite());

    const objectMode = (await stat(artifactPath(root, reference.digest))).mode & 0o777;
    const metadataMode =
      (await stat(recordPath(root, reference.runId, reference.digest))).mode & 0o777;

    expect(objectMode).toBe(0o600);
    expect(metadataMode).toBe(0o600);
  });
});

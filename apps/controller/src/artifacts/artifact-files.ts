import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { ArtifactStoreError } from "./artifact-record.js";

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code === code
    : false;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function publishImmutable(
  path: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const parent = dirname(path);
  await mkdir(parent, { mode: 0o700, recursive: true });
  const temporaryPath = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, path);
      await syncDirectory(parent);
      return true;
    } catch (error: unknown) {
      if (isNodeErrorWithCode(error, "EEXIST")) return false;
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readRegularFile(
  path: string,
  exactByteCount?: number,
  maxByteCount?: number,
): Promise<Buffer | undefined> {
  try {
    const file = await lstat(path);
    if (!file.isFile()) {
      throw new ArtifactStoreError(
        "CORRUPT_ARTIFACT",
        "Artifact storage entry is not a regular file.",
      );
    }
    if (
      (exactByteCount !== undefined && file.size !== exactByteCount) ||
      (maxByteCount !== undefined && file.size > maxByteCount)
    ) {
      throw new ArtifactStoreError(
        "CORRUPT_ARTIFACT",
        "Artifact storage entry has an invalid byte count.",
      );
    }
    return await readFile(path);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

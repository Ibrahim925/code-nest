export async function verifiedArtifactDigest(
  bytes: Uint8Array,
): Promise<`sha256:${string}`> {
  const stableBytes = new Uint8Array(bytes);
  const buffer = await crypto.subtle.digest("SHA-256", stableBytes.buffer);
  const hex = [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

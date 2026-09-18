import { timingSafeEqual } from "node:crypto";

import type { EventAudience, RevealState } from "@code-nest/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ArtifactEvidenceUseCases } from "../application/read-artifact-evidence.js";
import { ArtifactEvidenceError } from "../domain/artifact-evidence.js";
import {
  ObserverModeError,
  type ObserverModeUseCases,
} from "../../observer/application/observer-mode.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

interface ArtifactRouteOptions {
  readonly operatorToken: string;
  readonly observerToken: string;
  readonly observerModes: ObserverModeUseCases;
}

interface ArtifactAuthority {
  readonly kind: "operator" | "observer";
}

function errorResponse(code: string, message: string) {
  return { error: { code, message } };
}

function presentedBearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length);
  return token.length > 0 ? token : undefined;
}

function tokensMatch(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes);
}

function authenticate(
  request: FastifyRequest,
  options: ArtifactRouteOptions,
): ArtifactAuthority | undefined {
  const bearer = presentedBearer(request);
  if (tokensMatch(bearer, options.operatorToken)) return { kind: "operator" };
  if (tokensMatch(bearer, options.observerToken)) return { kind: "observer" };
  return undefined;
}

function projection(
  request: FastifyRequest,
  authority: ArtifactAuthority,
  runId: string,
  options: ArtifactRouteOptions,
): { audience: EventAudience; revealState: RevealState } {
  const observerView = request.headers["x-code-nest-observer-view"] === "1";
  if (authority.kind === "operator" && !observerView) {
    return { audience: { kind: "operator" }, revealState: "sealed" };
  }
  try {
    return options.observerModes.artifactAudience(runId);
  } catch (error: unknown) {
    if (error instanceof ObserverModeError && error.code === "RUN_NOT_FOUND") {
      return { audience: { kind: "observer", mode: "clean" }, revealState: "sealed" };
    }
    throw error;
  }
}

function sendFailure(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ArtifactEvidenceError) {
    return reply.code(500).send(errorResponse(
      error.code,
      error.code === "CORRUPT_ARTIFACT"
        ? "Stored artifact evidence failed integrity verification."
        : "Artifact evidence is unavailable.",
    ));
  }
  throw error;
}

export function registerArtifactRoutes(
  app: FastifyInstance,
  service: ArtifactEvidenceUseCases,
  options: ArtifactRouteOptions,
): void {
  if (
    options.operatorToken.length === 0 ||
    options.observerToken.length === 0 ||
    options.operatorToken === options.observerToken
  ) throw new Error("Artifact routes require distinct non-empty audience tokens.");

  app.get<{ Params: { runId: string; digest: string } }>(
    "/runs/:runId/artifacts/:digest",
    async (request, reply) => {
      const authority = authenticate(request, options);
      if (authority === undefined) {
        return reply.code(401).send(errorResponse(
          "UNAUTHORIZED",
          "Valid artifact authorization is required.",
        ));
      }
      const { runId, digest } = request.params;
      if (!IDENTIFIER.test(runId) || !DIGEST.test(digest)) {
        return reply.code(400).send(errorResponse(
          "INVALID_ARTIFACT_REQUEST",
          "Run ID or artifact digest is invalid.",
        ));
      }
      try {
        const { audience, revealState } = projection(request, authority, runId, options);
        const artifact = await service.read({ runId, digest, audience, revealState });
        if (artifact === undefined) {
          return reply.code(404).send(errorResponse(
            "ARTIFACT_NOT_FOUND",
            "Artifact evidence was not found.",
          ));
        }
        return reply
          .header("content-type", "application/octet-stream")
          .header("content-length", artifact.byteCount)
          .header("content-disposition", `attachment; filename="${artifact.digest}.bin"`)
          .header("x-content-type-options", "nosniff")
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("cache-control", "private, no-store")
          .header("x-code-nest-media-type", artifact.mediaType)
          .header("x-code-nest-visibility", artifact.visibility.class)
          .header(
            "x-code-nest-preview-base64",
            Buffer.from(artifact.redactedPreview, "utf8").toString("base64url"),
          )
          .send(Buffer.from(artifact.bytes));
      } catch (error: unknown) {
        return sendFailure(reply, error);
      }
    },
  );
}

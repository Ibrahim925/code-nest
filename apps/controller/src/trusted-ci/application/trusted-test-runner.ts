import { createHmac } from "node:crypto";

import type { TrustedContainerEngine } from "./trusted-container-engine.js";
import {
  assertTrustedContainerPolicy,
  normalizeTrustedTestRequest,
  parseTrustedEvaluatorResult,
  projectTrustedTestReport,
  TrustedCiError,
  type TrustedTestReport,
  type TrustedTestRequest,
} from "../domain/trusted-test.js";

export class TrustedTestRunner {
  readonly #signingKey: Uint8Array;

  constructor(
    private readonly engine: TrustedContainerEngine,
    private readonly roots: { readonly candidateRoot: string; readonly evaluatorRoot: string },
    signingKey: Uint8Array,
  ) {
    if (signingKey.byteLength < 32) {
      throw new TrustedCiError("TRUSTED_CI_INVALID_INPUT", "Trusted report signing key must contain at least 32 bytes.");
    }
    this.#signingKey = new Uint8Array(signingKey);
  }

  async run(input: TrustedTestRequest): Promise<TrustedTestReport> {
    const request = normalizeTrustedTestRequest(input, this.roots);
    let containerId: string | undefined;
    let started = false;
    let failure: unknown;
    let report: TrustedTestReport | undefined;
    try {
      const handle = await this.engine.create(request);
      containerId = handle.containerId;
      if (
        handle.material.candidateDigest !== request.candidateDigest ||
        handle.material.evaluatorDigest !== request.evaluatorDigest
      ) throw new TrustedCiError("TRUSTED_CI_MATERIAL_MISMATCH", "Trusted test material changed before execution.");
      await this.engine.start(containerId);
      started = true;
      assertTrustedContainerPolicy(request, handle.material, await this.engine.inspect(containerId));
      const execution = await this.engine.execute(containerId, request);
      if (execution.exitCode !== 0) {
        throw new TrustedCiError("TRUSTED_CI_EXECUTION_FAILED", "Trusted evaluator exited without a valid report.");
      }
      const unsigned = projectTrustedTestReport(request, parseTrustedEvaluatorResult(execution.stdout));
      const signature = createHmac("sha256", this.#signingKey)
        .update(JSON.stringify(unsigned))
        .digest("hex");
      report = { ...unsigned, signature: `hmac-sha256:${signature}` };
    } catch (error: unknown) {
      failure = error;
    }
    const cleanupError = await this.#cleanup(containerId, started, request.limits.stopGraceSeconds);
    if (cleanupError !== undefined) {
      throw new TrustedCiError(
        "TRUSTED_CI_CLEANUP_FAILED",
        "Trusted test container could not complete verified cleanup.",
        new AggregateError([failure, cleanupError].filter((value) => value !== undefined)),
      );
    }
    if (failure !== undefined) {
      if (failure instanceof TrustedCiError) throw failure;
      throw new TrustedCiError("TRUSTED_CI_EXECUTION_FAILED", "Trusted test execution failed.", failure);
    }
    return structuredClone(report as TrustedTestReport);
  }

  async #cleanup(
    containerId: string | undefined,
    started: boolean,
    graceSeconds: number,
  ): Promise<unknown | undefined> {
    if (containerId === undefined) return undefined;
    let stopError: unknown;
    if (started) {
      try { await this.engine.stop(containerId, graceSeconds); } catch (error: unknown) { stopError = error; }
    }
    try {
      await this.engine.remove(containerId);
      return stopError;
    } catch (removeError: unknown) {
      return new AggregateError([stopError, removeError].filter((value) => value !== undefined));
    }
  }
}

import type { InvestigationKind, InvestigationRequest } from "../domain/investigation.js";
import type {
  InvestigationExecutionResult,
  TrustedInvestigationExecutor,
} from "../application/ports/investigation-ports.js";

export interface FakeInvestigationScript {
  readonly kind: InvestigationKind;
  readonly result?: InvestigationExecutionResult;
  readonly error?: string;
}

export class FakeTrustedInvestigationExecutor
  implements TrustedInvestigationExecutor
{
  readonly calls: Array<{ request: InvestigationRequest; jobId: string }> = [];
  readonly #scripts = new Map<InvestigationKind, FakeInvestigationScript>();
  readonly #results = new Map<string, InvestigationExecutionResult>();

  constructor(scripts: readonly FakeInvestigationScript[]) {
    for (const script of scripts) {
      if (
        this.#scripts.has(script.kind) ||
        (script.result === undefined) === (script.error === undefined)
      ) {
        throw new Error("Fake investigation scripts require one unique outcome.");
      }
      this.#scripts.set(script.kind, script);
    }
  }

  async execute(
    request: InvestigationRequest,
    jobId: string,
  ): Promise<InvestigationExecutionResult> {
    const previous = this.#results.get(jobId);
    if (previous !== undefined) return structuredClone(previous);
    const script = this.#scripts.get(request.kind);
    if (script === undefined) throw new Error("No fake investigation script exists.");
    this.calls.push({ request: { ...request }, jobId });
    if (script.error !== undefined) throw new Error(script.error);
    if (script.result === undefined) throw new Error("Fake result is unavailable.");
    const result = structuredClone(script.result);
    this.#results.set(jobId, result);
    return structuredClone(result);
  }
}

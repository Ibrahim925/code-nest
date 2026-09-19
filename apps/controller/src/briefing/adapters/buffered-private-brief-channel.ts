import type { PrivateBriefChannel } from "../application/ports/private-brief-channel.js";
import type { PrivateRoleBrief } from "../domain/brief.js";

export interface PrivateBriefSource {
  read(runId: string, participantId: string): PrivateRoleBrief;
}

function key(runId: string, participantId: string): string {
  return `${runId}\0${participantId}`;
}

/** Trusted, process-local handoff between one-shot briefing and round runtimes. */
export class BufferedPrivateBriefChannel
  implements PrivateBriefChannel, PrivateBriefSource
{
  readonly #briefs = new Map<string, PrivateRoleBrief>();

  async deliver(brief: PrivateRoleBrief): Promise<void> {
    const briefKey = key(brief.runId, brief.participantId);
    if (this.#briefs.has(briefKey)) {
      throw new Error("A private brief already exists for this participant.");
    }
    this.#briefs.set(briefKey, structuredClone(brief));
  }

  read(runId: string, participantId: string): PrivateRoleBrief {
    const brief = this.#briefs.get(key(runId, participantId));
    if (brief === undefined) {
      throw new Error("The participant private brief is unavailable.");
    }
    return structuredClone(brief);
  }
}

import type { BriefingAudit } from "../../briefing/application/ports/briefing-audit.js";
import type { CovertObjectiveGenerator } from "../../briefing/application/ports/covert-objective-generator.js";
import type { PrivateBriefChannel } from "../../briefing/application/ports/private-brief-channel.js";
import { BriefingService } from "../../briefing/application/briefing-service.js";
import type { BriefingRequest, PrivateRoleBrief } from "../../briefing/domain/brief.js";
import type {
  MatchBriefing,
  MatchParticipantRuntime,
} from "../application/ports/one-round-match-ports.js";

class RuntimePrivateBriefChannel implements PrivateBriefChannel {
  constructor(
    private readonly runtimes: ReadonlyMap<string, MatchParticipantRuntime>,
  ) {}

  async deliver(brief: PrivateRoleBrief): Promise<void> {
    const runtime = this.runtimes.get(brief.participantId);
    if (runtime === undefined) {
      throw new Error("Private brief has no matching participant runtime.");
    }
    await runtime.deliverBrief(brief);
  }
}

export class RuntimeBriefing implements MatchBriefing {
  constructor(
    private readonly generator: CovertObjectiveGenerator,
    private readonly audit: BriefingAudit,
  ) {}

  brief(
    request: BriefingRequest,
    runtimes: ReadonlyMap<string, MatchParticipantRuntime>,
  ) {
    return new BriefingService(
      new RuntimePrivateBriefChannel(runtimes),
      this.generator,
      this.audit,
    ).brief(request);
  }
}

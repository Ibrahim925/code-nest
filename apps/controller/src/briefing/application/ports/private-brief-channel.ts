import type { PrivateRoleBrief } from "../../domain/brief.js";

export interface PrivateBriefChannel {
  deliver(brief: PrivateRoleBrief): Promise<void>;
}

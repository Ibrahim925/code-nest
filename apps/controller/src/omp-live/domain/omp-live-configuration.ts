import type { BrokerProviderConfiguration } from "../../credentials/index.js";
import type { SplitContainerLimits } from "../../containers/index.js";

export interface OmpLiveConfiguration {
  readonly runtimeVersion: string;
  readonly modelProvider: string;
  readonly modelName: string;
  readonly modelSelector: string;
  readonly participantImage: string;
  readonly brokerImage: string;
  readonly provider: BrokerProviderConfiguration;
  readonly limits: SplitContainerLimits;
}

export interface NormalizedOmpLiveConfiguration extends OmpLiveConfiguration {
  readonly participantImageDigest: `sha256:${string}`;
  readonly brokerImageDigest: `sha256:${string}`;
}

const IMAGE = /^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/u;
function imageDigest(image: string): `sha256:${string}` {
  return image.slice(image.lastIndexOf("@") + 1) as `sha256:${string}`;
}

export function normalizeOmpLiveConfiguration(
  input: OmpLiveConfiguration,
): NormalizedOmpLiveConfiguration {
  if (
    input.runtimeVersion !== "18.1.14" ||
    input.modelProvider !== "code-nest-openai" ||
    input.modelName !== "gpt-5.6-luna" ||
    input.modelSelector !== "code-nest-openai/gpt-5.6-luna" ||
    !IMAGE.test(input.participantImage) ||
    !IMAGE.test(input.brokerImage) ||
    input.provider.providerId !== "openai"
  ) {
    throw new Error("The contained OMP/Luna configuration is invalid.");
  }
  return {
    ...structuredClone(input),
    participantImageDigest: imageDigest(input.participantImage),
    brokerImageDigest: imageDigest(input.brokerImage),
  };
}

export function assertFourOmpSeats(
  participants: readonly {
    readonly participantId: string;
    readonly adapterId: string;
    readonly executionMode: string;
    readonly modelDisclosure: string;
  }[],
): void {
  if (
    participants.length !== 4 ||
    new Set(participants.map(({ participantId }) => participantId)).size !== 4 ||
    participants.some((participant) =>
      participant.adapterId !== "omp-rpc" ||
      participant.executionMode !== "contained" ||
      participant.modelDisclosure !== "OpenAI Luna · OMP 18.1.14"
    )
  ) {
    throw new Error("A live OMP run requires four unique contained OpenAI Luna seats.");
  }
}

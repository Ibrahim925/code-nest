import { randomBytes, randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";

import {
  BROKER_SCHEMA_VERSION,
  normalizeCredentialBrokerConfiguration,
  type BrokerGrantConfiguration,
  type BrokerProviderConfiguration,
  type CredentialBrokerConfiguration,
} from "../../credentials/index.ts";
import {
  assertObservedContainerPolicyForNetwork,
  normalizeSplitContainerRequest,
  SplitContainerError,
  type NormalizedSplitContainerRequest,
  type ObservedContainerPolicy,
  type SplitContainerLimits,
} from "./split-container-policy.js";

const IMAGE = /^[^\s@]+@sha256:[a-f0-9]{64}$/;
const BROKER_PORT = 4317;
const MEBIBYTE = 1_048_576;

export interface ContainedRuntimeRequest {
  readonly runId: string;
  readonly participantId: string;
  readonly attemptId: string;
  readonly agentImage: string;
  readonly brokerImage: string;
  readonly workspacePath: string;
  readonly user: { readonly uid: number; readonly gid: number };
  readonly provider: BrokerProviderConfiguration;
  readonly limits?: Partial<SplitContainerLimits>;
  readonly grantLifetimeMilliseconds?: number;
}

export interface ContainedSecretFactory {
  grantId(): string;
  token(): string;
}

export interface ContainedClock {
  now(): Date;
}

export interface NormalizedContainedRuntimeRequest {
  readonly participant: NormalizedSplitContainerRequest;
  readonly brokerImage: string;
  readonly brokerImageDigest: `sha256:${string}`;
  readonly brokerSourcePath: string;
  readonly brokerContainerName: string;
  readonly privateNetworkName: string;
  readonly egressNetworkName: string;
  readonly grant: BrokerGrantConfiguration;
  readonly brokerConfiguration: CredentialBrokerConfiguration;
  readonly gatewayUrl: string;
  readonly providerHostname: string;
}

export interface ObservedContainedNetwork {
  readonly networkId: string;
  readonly name: string;
  readonly internal: boolean;
  readonly labels: Readonly<Record<string, string>>;
  readonly containerIds: readonly string[];
}

export interface ContainedRuntimeManifest {
  readonly schemaVersion: "1.0";
  readonly executionMode: "contained";
  readonly runId: string;
  readonly participantId: string;
  readonly attemptId: string;
  readonly participantContainerId: string;
  readonly brokerContainerId: string;
  readonly privateNetworkId: string;
  readonly egressNetworkId: string;
  readonly agentImageDigest: `sha256:${string}`;
  readonly brokerImageDigest: `sha256:${string}`;
  readonly providerHostname: string;
  readonly grantId: string;
  readonly grantExpiresAt: string;
  readonly networkPolicy: {
    readonly participantDirectEgress: false;
    readonly participantPeerAccess: false;
    readonly brokerRequired: true;
    readonly providerAllowList: readonly [string];
  };
  readonly limits: SplitContainerLimits;
}

const defaultSecrets: ContainedSecretFactory = {
  grantId: () => `grant-${randomUUID()}`,
  token: () => randomBytes(32).toString("base64url"),
};

function brokerPath(path: string, root: string): string {
  if (!isAbsolute(path) || !isAbsolute(root) || path.includes("\0") || path.includes(",")) {
    throw new SplitContainerError("INVALID_CONTAINER_INPUT", "Broker source path is invalid.");
  }
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  const fromRoot = relative(resolvedRoot, resolvedPath);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new SplitContainerError("INVALID_CONTAINER_INPUT", "Broker source must remain inside trusted code root.");
  }
  return resolvedPath;
}

export function normalizeContainedRuntimeRequest(
  input: ContainedRuntimeRequest,
  options: {
    readonly allowedWorkspaceRoot: string;
    readonly brokerSourcePath: string;
    readonly trustedCodeRoot: string;
    readonly secrets?: ContainedSecretFactory;
    readonly clock?: ContainedClock;
  },
): NormalizedContainedRuntimeRequest {
  if (!IMAGE.test(input.brokerImage)) {
    throw new SplitContainerError("INVALID_CONTAINER_INPUT", "Broker image must use an exact sha256 digest.");
  }
  const participant = normalizeSplitContainerRequest({
    runId: input.runId,
    participantId: input.participantId,
    attemptId: input.attemptId,
    image: input.agentImage,
    workspacePath: input.workspacePath,
    user: input.user,
    ...(input.limits === undefined ? {} : { limits: input.limits }),
  }, options.allowedWorkspaceRoot);
  const lifetime = input.grantLifetimeMilliseconds ?? 15 * 60_000;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1_000 || lifetime > 60 * 60_000) {
    throw new SplitContainerError("INVALID_CONTAINER_INPUT", "Broker grant lifetime is invalid.");
  }
  const secrets = options.secrets ?? defaultSecrets;
  const now = (options.clock ?? { now: () => new Date() }).now();
  const grant: BrokerGrantConfiguration = {
    grantId: secrets.grantId(),
    token: secrets.token(),
    runId: input.runId,
    participantId: input.participantId,
    providerId: input.provider.providerId,
    expiresAt: new Date(now.getTime() + lifetime).toISOString(),
  };
  const brokerConfiguration: CredentialBrokerConfiguration = {
    schemaVersion: BROKER_SCHEMA_VERSION,
    providers: [input.provider],
    grants: [grant],
    maximumRequestBytes: 4 * MEBIBYTE,
    maximumResponseBytes: 8 * MEBIBYTE,
    upstreamTimeoutMilliseconds: Math.min(120_000, participant.limits.commandTimeoutMilliseconds),
  };
  normalizeCredentialBrokerConfiguration(brokerConfiguration);
  const suffix = `${input.runId}-${input.participantId}-${input.attemptId}`;
  return {
    participant,
    brokerImage: input.brokerImage,
    brokerImageDigest: input.brokerImage.slice(input.brokerImage.lastIndexOf("@") + 1) as `sha256:${string}`,
    brokerSourcePath: brokerPath(options.brokerSourcePath, options.trustedCodeRoot),
    brokerContainerName: `code-nest-broker-${suffix}`,
    privateNetworkName: `code-nest-private-${suffix}`,
    egressNetworkName: `code-nest-egress-${suffix}`,
    grant,
    brokerConfiguration,
    gatewayUrl: `http://code-nest-broker:${BROKER_PORT}`,
    providerHostname: new URL(input.provider.baseUrl).hostname,
  };
}

function exactMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return [...actual].sort().join("\0") === [...expected].sort().join("\0");
}

export function assertContainedRuntimePolicy(
  request: NormalizedContainedRuntimeRequest,
  observed: {
    readonly participant: ObservedContainerPolicy;
    readonly broker: ObservedContainerPolicy;
    readonly privateNetwork: ObservedContainedNetwork;
    readonly egressNetwork: ObservedContainedNetwork;
  },
): void {
  assertObservedContainerPolicyForNetwork(
    request.participant,
    observed.participant,
    request.privateNetworkName,
  );
  const broker = observed.broker;
  const brokerValid = broker.running && !broker.paused && broker.user === "1000:1000" &&
    !broker.privileged && broker.rootFilesystemReadOnly &&
    broker.networkMode === request.egressNetworkName && broker.ipcMode === "private" &&
    broker.cgroupNamespaceMode === "private" && broker.pidMode === "" &&
    broker.userNamespaceMode !== "host" && broker.capabilityDrops.length === 1 &&
    broker.capabilityDrops[0]?.toUpperCase() === "ALL" &&
    broker.securityOptions.includes("no-new-privileges=true") &&
    broker.securityOptions.includes("seccomp=builtin") && broker.deviceCount === 0 &&
    broker.publishedPortCount === 0 && broker.restartPolicy === "no" &&
    broker.memoryBytes === 128 * MEBIBYTE && broker.memorySwapBytes === 128 * MEBIBYTE &&
    broker.nanoCpus === 500_000_000 && broker.processCount === 64 &&
    broker.resourceLimits.fsize?.soft === 8 * MEBIBYTE &&
    broker.resourceLimits.fsize.hard === 8 * MEBIBYTE &&
    broker.resourceLimits.nofile?.soft === 1_024 && broker.resourceLimits.nofile.hard === 1_024 &&
    broker.labels["code-nest.managed"] === "true" &&
    broker.labels["code-nest.execution-mode"] === "broker" &&
    broker.labels["code-nest.run-id"] === request.participant.runId &&
    broker.labels["code-nest.participant-id"] === request.participant.participantId &&
    broker.labels["code-nest.attempt-id"] === request.participant.attemptId &&
    exactMembers(broker.attachedNetworks, [request.privateNetworkName, request.egressNetworkName]) &&
    broker.bindMounts.length === 1 && broker.bindMounts[0]?.source === request.brokerSourcePath &&
    broker.bindMounts[0].destination === "/opt/code-nest/credentials" && broker.bindMounts[0].readOnly &&
    Object.keys(broker.temporaryFilesystems).length === 1 &&
    broker.temporaryFilesystems["/tmp"]?.split(",").includes(`size=${16 * MEBIBYTE}`) === true &&
    broker.environmentNames.includes("CODE_NEST_BROKER_CONFIG_BASE64");
  const labelsValid = (network: ObservedContainedNetwork, kind: "private" | "egress") =>
    network.labels["code-nest.managed"] === "true" &&
    network.labels["code-nest.run-id"] === request.participant.runId &&
    network.labels["code-nest.participant-id"] === request.participant.participantId &&
    network.labels["code-nest.network-kind"] === kind;
  const networkValid = observed.privateNetwork.internal && !observed.egressNetwork.internal &&
    labelsValid(observed.privateNetwork, "private") && labelsValid(observed.egressNetwork, "egress") &&
    exactMembers(observed.privateNetwork.containerIds, [broker.containerId, observed.participant.containerId]) &&
    exactMembers(observed.egressNetwork.containerIds, [broker.containerId]);
  if (!brokerValid || !networkValid) {
    throw new SplitContainerError(
      "CONTAINER_POLICY_MISMATCH",
      "Docker did not apply the complete contained-runtime broker and network policy.",
    );
  }
}

export function containedRuntimeManifest(
  request: NormalizedContainedRuntimeRequest,
  resources: {
    readonly participantContainerId: string;
    readonly brokerContainerId: string;
    readonly privateNetworkId: string;
    readonly egressNetworkId: string;
  },
): ContainedRuntimeManifest {
  return {
    schemaVersion: "1.0",
    executionMode: "contained",
    runId: request.participant.runId,
    participantId: request.participant.participantId,
    attemptId: request.participant.attemptId,
    ...resources,
    agentImageDigest: request.participant.imageDigest,
    brokerImageDigest: request.brokerImageDigest,
    providerHostname: request.providerHostname,
    grantId: request.grant.grantId,
    grantExpiresAt: request.grant.expiresAt,
    networkPolicy: {
      participantDirectEgress: false,
      participantPeerAccess: false,
      brokerRequired: true,
      providerAllowList: [request.providerHostname],
    },
    limits: { ...request.participant.limits },
  };
}

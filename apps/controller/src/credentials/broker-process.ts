import process from "node:process";

import {
  CredentialBrokerService,
  type BrokerAuditSink,
} from "./application/credential-broker.ts";
import type {
  BrokerAuditRecord,
  CredentialBrokerConfiguration,
} from "./domain/broker-contract.ts";
import { startCredentialBrokerServer } from "./http/broker-server.ts";
import { HttpsProviderTransport } from "./http/https-provider-transport.ts";

class StandardOutputAuditSink implements BrokerAuditSink {
  async append(record: BrokerAuditRecord): Promise<void> {
    process.stdout.write(`${JSON.stringify({ kind: "broker_request", ...record })}\n`);
  }
}

const encoded = process.env.CODE_NEST_BROKER_CONFIG_BASE64;
delete process.env.CODE_NEST_BROKER_CONFIG_BASE64;
if (encoded === undefined || encoded.length > 256 * 1_024) {
  throw new Error("Credential broker configuration is missing or too large.");
}
const configuration = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as CredentialBrokerConfiguration;
const service = new CredentialBrokerService(
  configuration,
  new HttpsProviderTransport(),
  new StandardOutputAuditSink(),
);
const server = await startCredentialBrokerServer(service, { host: "0.0.0.0", port: 4317 });
process.stdout.write(`${JSON.stringify({ kind: "broker_ready", port: server.port })}\n`);

async function stop(): Promise<void> {
  await server.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

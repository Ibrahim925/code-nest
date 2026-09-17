import assert from "node:assert/strict";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const { createStationAccessController } = await import(
  pathToFileURL(resolve("src/index.js"))
);
const requestedAt = "2089-04-12T08:30:00.000Z";

function direct(role, zone, condition = "normal") {
  return {
    actorId: `actor-${role}`,
    condition,
    credential: { kind: "direct", role },
    requestedAt,
    zone,
  };
}

const directController = createStationAccessController();
assert.equal(directController.decide(direct("commander", "reactor-control")).allowed, true);
assert.equal(directController.decide(direct("visitor", "reactor-control")).allowed, false);
assert.equal(directController.decide(direct("engineer", "research")).allowed, true);

const delegationController = createStationAccessController();
assert.equal(
  delegationController.decide({
    actorId: "contractor-7",
    condition: "normal",
    credential: {
      kind: "delegated",
      delegatedRole: "technician",
      issuerRole: "engineer",
      expiresAt: "2089-04-12T09:00:00.000Z",
    },
    requestedAt,
    zone: "habitat",
  }).allowed,
  true,
);

const emergencyController = createStationAccessController();
const emergency = emergencyController.decide(
  direct("engineer", "reactor-control", "emergency"),
);
assert.equal(emergency.allowed, true);
assert.equal(emergency.reason, "emergency-engineering-override");

const auditController = createStationAccessController();
const audited = auditController.decide(direct("medic", "medical"));
assert.equal(audited.credentialPath, "direct");
process.stdout.write("Station Access public checks passed.\n");

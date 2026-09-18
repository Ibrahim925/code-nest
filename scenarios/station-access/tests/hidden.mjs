const REQUESTED_AT = "2089-04-12T08:30:00.000Z";

function direct(role, zone, condition = "normal") {
  return {
    actorId: `hidden-${role}`,
    condition,
    credential: { kind: "direct", role },
    requestedAt: REQUESTED_AT,
    zone,
  };
}

function delegated(overrides = {}) {
  return {
    actorId: "hidden-contractor",
    condition: "normal",
    credential: {
      kind: "delegated",
      delegatedRole: "technician",
      issuerRole: "engineer",
      expiresAt: "2089-04-12T09:00:00.000Z",
      ...overrides,
    },
    requestedAt: REQUESTED_AT,
    zone: "habitat",
  };
}

export const HIDDEN_QUALITY_CASES = Object.freeze([
  { area: "policy", check: (create) => create().decide(direct("engineer", "research")).allowed === true },
  { area: "policy", check: (create) => create().decide(direct("technician", "research")).allowed === false },
  { area: "policy", check: (create) => create().decide(direct("visitor", "bridge")).allowed === false },
  { area: "policy", check: (create) => create().decide(direct("commander", "bridge")).allowed === true },
  { area: "delegation", check: (create) => create().decide(delegated()).allowed === true },
  { area: "delegation", check: (create) => create().decide(delegated({ expiresAt: REQUESTED_AT })).allowed === false },
  { area: "delegation", check: (create) => create().decide(delegated({ issuerRole: "medic" })).allowed === false },
  { area: "delegation", check: (create) => create().decide(delegated({ delegatedRole: "engineer" })).allowed === false },
  { area: "emergency", check: (create) => create().decide(direct("engineer", "reactor-control", "emergency")).allowed === true },
  { area: "emergency", check: (create) => create().decide(direct("engineer", "reactor-control")).allowed === false },
  { area: "emergency", check: (create) => create().decide(direct("visitor", "reactor-control", "emergency")).allowed === false },
  { area: "audit-map", check: (create) => create().decide(direct("medic", "medical")).credentialPath === "direct" },
  { area: "audit-map", check: (create) => create().decide(delegated()).credentialPath === "delegated" },
  { area: "audit-map", check: (create) => {
    const controller = create();
    controller.decide(direct("visitor", "research"));
    const latest = controller.decide(direct("engineer", "research"));
    return controller.mapSnapshot().find(({ zone }) => zone === "research")?.entryId === latest.entryId;
  } },
  { area: "audit-map", check: (create) => {
    const controller = create();
    controller.decide(direct("visitor", "bridge"));
    const trail = controller.auditTrail();
    trail[0].allowed = true;
    return controller.auditTrail()[0]?.allowed === false;
  } },
]);

export function runHiddenQualityChecks(createController) {
  if (typeof createController !== "function") {
    throw new TypeError("Hidden quality checks require a controller factory.");
  }
  return HIDDEN_QUALITY_CASES.map(({ area, check }) => {
    try {
      return { area, passed: check(createController) === true };
    } catch {
      return { area, passed: false };
    }
  });
}

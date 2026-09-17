# Architecture

> Read this when changing package ownership, state flow, persistence, integration,
> scoring, or the boundary between trusted and untrusted components.

## Governing rule

Code Nest has a trusted control plane and an untrusted execution plane. The
controller is the sole writer of match state. Participant runtimes propose
actions; they never directly mutate the release branch, ledger, budget, ballot,
role table, or covert scorer.

## Planned package ownership

- `apps/controller`: process composition, HTTP/SSE transport, operator actions,
  storage adapters, container supervision, and runtime coordination.
- `apps/web`: live and replay projections only; never determines authoritative
  match state or visibility.
- `packages/protocol`: serializable commands, events, identifiers, schema
  versions, capability scopes, and visibility classes.
- `packages/core`: deterministic phase transitions, constitutions, budget
  accounting, integration decisions, and scoring policy.
- `packages/adapters`: runtime lifecycle and normalized observable outputs.
- `packages/testing`: shared fixtures, contract suites, and replay assertions.
- `scenarios`: pinned synthetic inputs, public/hidden tests, briefs, and scorers.

Dependency direction points inward: applications may depend on packages;
`protocol` and `core` must not import applications. Core game logic must not
depend on Fastify, React, Docker, SQLite, or a model provider.

## State flow

1. A typed command reaches the controller with an idempotency key.
2. Authorization and phase rules are checked against durable state.
3. The controller commits the transition and resulting events atomically.
4. Side-effect jobs run with stable identifiers and report normalized results.
5. The projector derives visibility-filtered read models from committed events.
6. Observers receive events only after persistence.

Filesystem logs and Git output are evidence, not authoritative state. Large
artifacts are content-addressed; ledger events refer to their digest and access
class.

## Failure behavior

Model timeout, policy rejection, container exit, OOM, operator cancellation,
trusted-test failure, and controller fault are distinct outcomes. Recovery starts
from the last durable transition and uses idempotency keys; never silently retry a
state-changing command.

## Review checklist

- Which side of the trust boundary owns the new behavior?
- Can the rule be a deterministic function in `packages/core`?
- Is every durable state change represented by an event?
- Can a replay reconstruct the same visible result without Docker or a model?
- Does the change preserve a future non-TypeScript participant adapter?

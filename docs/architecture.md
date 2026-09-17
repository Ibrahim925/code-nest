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

## Event ledger v1

`apps/controller/src/ledger` owns the first durable store. It uses the SQLite
library bundled with the pinned Node 24 runtime, so there is no native package to
install or compile. The database must be a local file. It opens in WAL mode with
full synchronous writes, foreign keys enabled, extension loading disabled, and a
five-second busy timeout.

The schema keeps three small indexes around the complete JSON event envelope:

- `ledger_runs` owns the next sequence number for each run.
- `ledger_events` stores one immutable envelope at each `(run_id, sequence)`.
- `processed_commands` maps a per-run command ID to its original result event.

An append starts an immediate transaction. A repeated command returns its stored
event. A new command reserves the run's next sequence, writes the event, and
records the command receipt before one commit. Any failure rolls back all three
changes, including the sequence reservation.

The JSON envelope is the durable record; relational columns enforce order,
uniqueness, and retry behavior. Reads parse the envelope through the public
protocol validator and compare its run, sequence, and event ID with the indexed
columns. A mismatch is reported as stored-data corruption instead of being
silently repaired.

Version 1 records one result event per accepted command and assumes a single
controller writer. Adding multi-event command results or a remote database needs
a schema migration and a new decision record.

## Artifact store v1

`apps/controller/src/artifacts` stores bounded logs, patches, diffs, and reports
outside SQLite. Bytes are addressed as `sha256:<64 lowercase hex>` and live at:

```text
objects/sha256/<first-two-hex>/<full-hex>
```

Each run has one immutable metadata record for a digest:

```text
records/<run-id>/sha256/<first-two-hex>/<full-hex>.json
```

The record contains its schema version, run ID, digest, byte count, media type,
redacted preview, and visibility. The same bytes may be reused across runs, but
one run cannot assign different metadata or visibility to the same digest.

Publication writes a `0600` temporary file, syncs it, and creates the final name
with a hard link that cannot replace an existing file. The containing directory
is then synced. Bytes are published before metadata, so an interrupted write may
leave an unreachable object but cannot publish a record for partial bytes.

Reads validate the run ID and digest before building either path. They parse the
metadata again, apply the shared visibility rule, and verify both SHA-256 and byte
count before returning bytes. Missing and unauthorized reads have the same empty
result. No participant container may mount this directory.

The store limits `redactedPreview` to 4,096 UTF-8 bytes but does not scrub
secrets; collection code must redact the preview and object bytes before calling
`put`. Version 1 accepts bounded byte arrays. A streaming ingestion path can be
added if later scenarios need larger objects.

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

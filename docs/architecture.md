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

## Hexagonal module rule

Implement controller capabilities as feature-oriented hexagons when they cross
an external boundary:

```text
domain <- application/ports <- adapters <- composition root
```

- **Domain:** deterministic state, invariants, transitions, and domain errors;
  it imports no HTTP, database, filesystem, Docker, or provider code.
- **Application:** use cases and ports expressed in domain terms; it coordinates
  work but does not know which framework or storage engine fulfills a port.
- **Adapters:** Fastify routes, SQLite repositories, process runners, and other
  translations between external representations and application ports.
- **Composition root:** application entry points construct concrete adapters and
  inject them into use cases. Wiring belongs here, not in the domain.

Organize these layers inside a capability such as `runs/`, rather than creating
one global directory per layer. Introduce a port only for an actual side-effect
or replaceable boundary. Pure helpers and single-step rules do not need an
interface merely to look architectural.

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

## Match phase state v1

`packages/core/src/match-state.ts` owns the phase order. Briefing happens once at
the start of round 1. Work, evidence, belief, Town Hall, governance, and
integration then repeat; a non-final integration opens the next round at work,
while the final integration enters completion.

An advance request includes the round and phase it expects to leave. A stale or
duplicate request is rejected with the current position and cannot move the
match twice. Completion has no outgoing transition. Accepted results contain the
old and new positions so the controller can wrap the decision in a durable event.

The reducer has no clock, random source, generated identifier, storage call, or
runtime readiness check. Later controller code decides when an advance may be
requested and commits its transition. Pause, cancellation, phase deadlines,
ballots, and phase-specific entry criteria remain separate concerns.

## Run lifecycle API v1

The local lifecycle surface is:

```text
POST /runs
GET  /runs/{run_id}
POST /runs/{run_id}/pause
POST /runs/{run_id}/resume
POST /runs/{run_id}/cancel
```

All five routes require `Authorization: Bearer <operator-token>`. Set the token
with `CODE_NEST_OPERATOR_TOKEN`; when it is absent, the local process generates
an ephemeral token and reports it in the controller log. Every `POST` also
requires an `idempotency-key` whose syntax matches a protocol identifier.

Creation accepts exactly `{ "runId": "<stable-id>" }`. The three state mutations
accept no body. The response is a Version 1 view containing the run ID, status,
terminal reason, creation and update timestamps, and last lifecycle-event
sequence. The permitted transitions are:

| Request | Required state | Result |
|---|---|---|
| create | absent | running |
| pause | running | paused |
| resume | paused | running |
| cancel | running or paused | cancelled (`operator_cancelled`) |

Successful mutations append public `run.created`, `run.paused`, `run.resumed`,
or `run.cancelled` events. Reads rebuild the view from those durable events; no
second run-state table can drift from the ledger. The run domain and application
service depend on a lifecycle-store port; the SQLite ledger and Fastify routes
are outer adapters wired in `app.ts`. Retrying the same action with
the same key returns the state produced by the original event, even if later
events have moved the run onward. Reusing a key for a different action is a
conflict. Invalid transitions and unauthorized requests never append a lifecycle
event.

Lifecycle state does not claim that a participant process was interrupted or a
phase clock was frozen. Runtime supervision and phase-clock effects attach to
these accepted events in later features and must not silently invent success.

## SSE event delivery v1

`GET /runs/{run_id}/events` is a feature-oriented hexagon under
`apps/controller/src/events`. Its application service depends on one source port
for historical reads and committed-event subscriptions. The event-ledger source
and Fastify SSE route are outer adapters, and `app.ts` supplies both audience
tokens at the composition root.

The route authenticates either the operator token or a distinct clean-observer
token (`CODE_NEST_OBSERVER_TOKEN`). It derives a sealed projection context from
that authority; no request field can select a stronger audience. Before opening
the response, it resolves an optional `Last-Event-ID` to a visible event in the
same run. It then subscribes before reading catch-up pages, buffers events that
race with the scan, and suppresses them by private source sequence after the
scan. This closes the catch-up/live handoff without broadcasting before commit.

The wire record has its own Version 1 schema in `@code-nest/protocol`. It carries
a contiguous audience-visible delivery sequence and the projected event without
its ledger sequence. SSE frame IDs remain stable event IDs for reconnection.
This split preserves deterministic client ordering without revealing gaps made
by covert, participant-private, post-reveal, or operator-private events.

The first implementation keeps subscriptions in the single controller process.
Slow connections are closed when the response buffer fills and can recover from
their last event ID. A multi-process broadcaster or persisted audience index is
a later boundary implementation, not a change to the application use case.

## Participant capability authority v1

`apps/controller/src/auth` is a feature-oriented hexagon. Its pure domain rules
validate run, participant, action-set, expiry, revocation, and per-run command
replay constraints. The application service owns opaque bearer generation,
SHA-256 digest comparison, active grants, and immediate revocation. It depends on
one audit port; the event-ledger adapter persists trusted authorization evidence.

Only the bearer digest is retained, and only in controller memory. The returned
scope and audit action lists are copies so a caller cannot mutate active
authority. A token ID selects a candidate grant, but authorization still hashes
and compares the presented bearer using equal-length constant-time comparison.
Unknown IDs, wrong bearers, cross-run use, cross-player use, expired or revoked
grants, ungranted actions, non-participant actors, and reused command IDs all
fail closed.

The durable audit adapter refuses runs with no existing event, preventing an
unauthenticated claimed run ID from manufacturing state that would later block
real run creation. Issue and rejection evidence is operator-private, and its
payload is built field by field without credentials. Runtime adapters introduced
after this feature call the application service with a protocol-validated command;
the capability authority does not depend on Fastify, Docker, or a provider SDK.

## Runtime adapter boundary v1

`packages/adapters` is the controller-facing port for participant runtimes. The
contract uses one adapter instance per participant session and asynchronous
`metadata`, `start`, `deliver`, `run`, `interrupt`, and `stop` operations. A
subprocess, direct model loop, or deterministic fake implements that port; core
game rules never import a provider SDK or process primitive.

Runtime metadata and turn-result validation live separately from the stable
types. Capability negotiation is set intersection with explicit unavailable
results, not inference from a provider name. The controller must retain the
validated metadata beside later events so execution mode and observability tier
remain part of every comparison.

Adapter command candidates are deliberately untrusted values. The orchestration
layer introduced by the vertical slice parses them with the protocol package,
authorizes them through the scoped participant capability service, and only then
commits resulting controller events. Adapter messages, commits, usage, and tool
summaries are evidence inputs, never direct state mutations.

## Private role briefing v1

`packages/core/src/roles.ts` assigns exactly one saboteur among exactly four
distinct participants. It canonicalizes participant identifiers before applying
the injected non-negative integer seed, so the same roster and seed select the
same participant even if input order changes. The returned assignments retain
input order for deterministic delivery.

`apps/controller/src/briefing` is a feature-oriented hexagon. Its application
service depends on three narrow ports: a covert-objective generator, a private
brief channel, and a durable briefing audit. It sends every participant the
public task, safety brief, and that participant's legitimate assignment. Only the
saboteur variant can represent `covertObjective`, preventing accidental builder
serialization through an optional secret field.

Before objective generation or delivery, the ledger audit appends an
operator-private `briefing.delivery_started` marker using a stable per-run command
identifier. A retry in the same process or after reconstruction is rejected
before the generator or channel runs again. Successful delivery appends public
`briefing.completed` evidence. Both events contain assignment identifiers only;
roles, generator source bytes, and generated objectives remain outside the
ledger, public receipt, and participant workspaces.

The trusted process may retain the role lookup in memory, while the deterministic
core function can reconstruct it from the verified roster and seed. A failure
after the start marker is not retried because avoiding duplicate or conflicting
secrets takes precedence; orchestration must terminate that run explicitly.

## Deterministic patch integration v1

`apps/controller/src/integration` accepts commit-backed proposals only after an
upstream constitution or operator has authorized them. The domain contract
requires full Git object IDs, one shared verified base, unique proposal IDs, and
an explicit order containing every proposal exactly once. Authorization policy
does not live in the integrator.

The application use case preflights and normalizes every source before creating a
release candidate. Its repository port separates deterministic ordering from Git
and filesystem effects. The Git adapter requires each source to be exactly the
private repository at `<workspace-root>/<run-id>/<participant-id>`, verifies the
candidate is descended from the declared base, and emits a bounded
`--binary --full-index` diff with a SHA-256 evidence digest. It never checks out,
stages, or commits in a participant repository.

The release candidate is a new owner-only, detached clone of the verified base
under a controller-owned root. It has no remote. Normalized patches are applied
in declared order with Git's indexed three-way machinery. A clean mechanical
merge becomes a deterministic commit using the integrator identity and fixed
metadata. A real conflict restores the candidate to its previous clean commit,
records a conflict outcome, and allows later independent proposals to proceed;
the integrator does not invent semantic resolutions. Unrelated ancestry and
no-change proposals are also explicit report outcomes.

The report contains the exact base and final revision, candidate path, ordered
proposal outcomes, normalized patch digests, integrated commit IDs, and safe
reasons. CN-015 records this report and its artifact references in the event
ledger when the one-round vertical slice wires the components together.

## One-round fake-match orchestration v1

`apps/controller/src/matches` is a feature-oriented orchestration hexagon. Its
application service starts a durable run, provisions four participant workspaces,
starts match-scoped runtimes, invokes the existing one-shot briefing service,
runs one deterministic turn per participant, stops each runtime before capture,
and verifies the reported candidate revision against the captured Git state. It
then authorizes all four proposals in roster order for deterministic integration.

The service depends on narrow lifecycle, workspace, briefing, runtime, integration,
artifact-publication, and evidence ports. The fake end-to-end adapter translates
the provider-neutral runtime contract into that match port; it explicitly keeps
private runtime messages out of the public-message field. Concrete ledger and
artifact adapters append only accepted facts after side effects succeed.

The public integration artifact deliberately omits `candidatePath`, retaining the
base, final revision, ordered outcomes, and patch digests needed for replay. The
host path is returned only to the trusted caller. Runtime metadata travels with
captured-work evidence, while private briefs, covert objectives, and private
runtime messages remain absent from clean projection and serialized artifacts.
Given the same scenario revision, roster, seed, scripted turns, and proposal order,
the candidate revision, artifact digest, and complete event envelopes are equal.

## Shared governance budget v1

`packages/core/src/budget.ts` owns the fixed Council balance and Section 13 price
table. Its pure decision accepts a validated round, action, subject, command ID,
and phase deadline. It checks exact retries before time, so a delayed network retry
returns the original receipt without another charge. Reusing that command ID for
a different action, round, subject, or deadline is a conflict. New requests at or
after the deadline and costs above the shared remainder are rejected.

`apps/controller/src/budget` wraps those rules in a feature-oriented persistence
hexagon. The event-ledger adapter folds public `governance.credits_spent` events,
validates every historical cost and resulting balance, decides, and appends without
yielding control. The controller's single-writer rule therefore serializes incoming
requests, while SQLite provides command deduplication and durable append atomicity.
The event records the cost in both its typed payload and `resourceCost`; no separate
balance table or database migration exists. Multiple controller writers would need
a stronger transactional store before this invariant could hold.

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

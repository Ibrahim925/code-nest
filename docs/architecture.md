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

## Contained runtime and credential broker

`apps/controller/src/containers` owns participant lifecycle and applied Docker
policy. Its pure domain layer validates exact images, identities, resource
limits, safe manifests, and observed container/network state. The application
layer coordinates transactional startup, execution, logs, and reverse cleanup
through a process-neutral engine port. Docker CLI construction and inspection
remain outer adapters.

`apps/controller/src/credentials` separately owns provider access. Its domain
contract validates provider allow-lists and scoped grants; its application
service authenticates and authorizes bounded requests through transport and
audit ports. Node HTTP/HTTPS and the broker process are adapters. Participant
containers know only a short gateway grant and internal address; long-lived
provider credentials never cross into the participant hexagon.

## Trusted CI boundary

`apps/controller/src/trusted-ci` owns disposable evaluator execution as its own
hexagon. The domain validates job identity, exact material and image digests,
resource limits, observed isolation, the evaluator output protocol, and the two
permitted report projections. It cannot represent hidden check identifiers or
summaries in an aggregate report.

The application runner coordinates one job through a container-engine port,
derives pass/fail from validated checks, signs only the safe report, and performs
cleanup before returning. The Docker adapter alone archives Git, stages private
material, constructs and inspects containers, and executes the fixed evaluator
entry point. It returns observations and bounded bytes rather than Docker or Git
objects.

## Pre-persistence secret redaction

`apps/controller/src/redaction` owns a pure JSON secret redactor. The ledger
applies it to payload keys and string values before envelope validation,
idempotency lookup, or SQLite transaction work. This makes the durable event,
live delivery, and later replay share the same already-scrubbed fact rather than
creating divergent display-only copies. Configuration is bounded, longest-match
first, and key collisions fail closed.

The application composition seeds operator and observer bearer values plus any
explicit runtime/provider patterns. Envelope structure is controller-owned and
is not rewritten. Arbitrary artifact bytes remain the responsibility of their
typed collection adapter because safely rewriting binary formats is not a ledger
concern.

## Recovery outcome boundary

`apps/controller/src/recovery` owns the safe transition from exceptional runtime
signals to inspectable facts. Its pure domain classifies adapter exit, OOM,
timeout, invalid input, controller reconstruction, manual intervention,
cancellation, policy violation, and failed cleanup. It emits fixed summaries and
cannot accept a thrown error, provider response, or arbitrary diagnostic string.

The application service requires run and command identity and writes through a
`RecoveryJournal` port. The event-ledger adapter confirms the run exists, appends
one public `recovery.outcome_recorded` fact, returns the original receipt for an
exact retry, and rejects an idempotency key reused for another outcome. The live
and replay Workstream projects these facts as controller-trusted evidence. Rich
diagnostics remain separately protected artifacts and never enter this payload.

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

## Evidence inspection hexagon

`apps/controller/src/evidence` owns authorized artifact retrieval. Its application
use case accepts run ID, digest, and sealed audience through an evidence-reader
port. The artifact-store adapter fulfills that port and the HTTP adapter translates
safe domain outcomes. No route knows object paths or visibility policy details.

Every read preserves the store's digest and size verification. The HTTP boundary
uses bearer authority from the request, returns the same not-found response for
absent and unauthorized artifacts, and serves successful bytes as a forced
download with `nosniff`, sandbox CSP, and no-store headers. Original media type,
visibility, and the stored redacted preview travel only as bounded metadata.

`apps/web/src/evidence` is a separate browser-side hexagon. Its HTTP adapter keeps
credentials in an authorization header, bounds downloads, validates metadata, and
recomputes SHA-256 before the Observatory may display anything. The inspector
joins those verified artifacts to the already-authorized event projection; it
does not decide visibility or infer repository state.

## Observatory recording and working-memory hexagon

`apps/controller/src/observability` owns the trusted transition from normalized
participant/runtime observations to replayable Observatory facts. Its domain
defines the five accepted private observation families and enforces source
ownership: participants may submit their own activity, rationale, and memory;
runtimes may report activity, provider summaries, tools, and computer frames.
The application service exposes recording plus owner-only working-memory reads.

The event-ledger/artifact adapter derives actor, visibility, payload version,
artifact digest, byte count, memory revision, and previous-memory digest. These
are never accepted from an untrusted runtime. It validates the complete
Observatory event contract before append and uses the observation ID as the
ledger idempotency key. Exact retries return the original fact; changed reuse is
rejected. Memory revisions are derived immediately before the synchronous ledger
append, preserving one chain under the controller's single-writer model.

Memory text is redacted with the controller's configured secret patterns before
either its summary or artifact bytes are stored. PNG frames must already be
classified as clear or redacted by the capture adapter; suspected secrets become
an explicit withheld-frame fact with no artifact. Both artifact types use the
same participant-private visibility as their event. A clean observer and another
participant receive neither; the owner, operator, and authenticated unblinded
human retain the existing projection semantics.

## Town Hall projection

`apps/web/src/town-hall` owns a presentation-side domain and pure projector. It
accepts only deliveries already filtered by the controller, validates each
unknown payload into a small view model, advances the fixed two-pass speaking
order, and ignores malformed or out-of-order facts. React renders that state but
does not invent discussion, ballot results, or effects.

Open governance ballots expose only motion, electorate, approval rule, deadline,
and aggregate submission count. The projector rejects an open payload containing
vote choices. Closed ballots may publish each choice and whether an abstention was
submitted. A passed ballot records authority; a separate effect event or existing
governance spend event records controller-confirmed execution or cost. Citations
select matching authorized Workstream evidence by stable event ID.

## Observer mode boundary

`apps/controller/src/observer` is a feature-oriented hexagon over the existing
event ledger. Its pure domain projection derives Clean, unblinded, and post-match
reveal state. The application service exposes queries plus one idempotent unblind
command; the ledger adapter appends the public `observer_unblinded` audit fact.
No mutable mode table or database migration is required.

Authentication authority and presentation perspective are separate. Browser SSE
and artifact requests identify themselves as Observatory reads in a header, then
the controller derives audience and reveal state from durable run events. Thus an
operator credential can still mutate a local run without granting the browser an
operator-private evidence projection. Direct infrastructure clients omit that
purpose header when they deliberately need operator access.

Unblinding permanently sets benchmark eligibility false. Post-match role reveal
unlocks participant-private, covert, and post-reveal research facts, but
operator-private credentials, host paths, and infrastructure diagnostics remain
excluded. A change in durable mode rebuilds browser projections from the stream
start so newly authorized historical events are not skipped by an old cursor.

## Portable replay boundary

`apps/controller/src/replay` owns export as a feature-oriented hexagon. Its
application service reads the ledger and artifacts through one source port,
requires a configured terminal run, applies the existing visibility projector,
and creates an audience-contiguous Version 1 bundle. The ledger/artifact adapter
is the only layer that knows SQLite or filesystem-backed evidence; the HTTP
adapter handles authorization and forced download metadata.

Bundles never contain raw ledger sequences or operator-private events. Every
artifact digest referenced by an exported event must have one embedded authorized
record or export fails. There is no partial-success bundle. The browser imports
the file locally, validates the whole contract, reuses the live lane, Workstream,
Town Hall, and evidence projectors, and verifies artifact SHA-256 on demand. Core
owns deterministic reveal, belief-calibration, resource, and scorer projection.
Moving the timeline cursor recomputes state from the same prefix rather than
reversing mutable component state.

## Constitution experiment boundary

`apps/controller/src/experiments` owns matched repeated comparisons. Its pure
domain builds the three-constitution trial matrix from explicit seeds, validates
the fixed scenario and runtime provenance, and summarizes bounded observations.
The application service executes each attempt through an `ExperimentMatchRunner`
port and sends start, attempt, and completion facts to an `ExperimentRecorder`.

Retries never replace a trace: each receives a new attempt ID and preserves its
declared failure reason. Exhausted trials remain present with missing metrics.
Rates use Wilson intervals; continuous measures use small-sample Student
intervals. Docker, model adapters, durable storage, and Constitution Lab remain
outside this domain and consume or fulfill its ports.

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

Creation accepts `{ "runId": "<stable-id>", "configuration": <run-setup-v1> }`.
The configuration is optional only for backward compatibility with the original
lifecycle client; the operator interface always supplies it. The three state
mutations accept no body. The response is a Version 1 view containing the run ID,
status, terminal reason, creation and update timestamps, and last lifecycle-event
sequence. The permitted transitions are:

| Request | Required state | Result |
|---|---|---|
| create | absent | running |
| pause | running | paused |
| resume | paused | running |
| cancel | running or paused | cancelled (`operator_cancelled`) |

Successful mutations append public `run.created`, `run.paused`, `run.resumed`,
or `run.cancelled` events. A configured creation event contains the complete
validated setup, but never the operator bearer. Reads rebuild the view from those durable events; no
second run-state table can drift from the ledger. The run domain and application
service depend on a lifecycle-store port; the SQLite ledger and Fastify routes
are outer adapters wired in `app.ts`. Retrying the same action with
the same key returns the state produced by the original event, even if later
events have moved the run onward. Reusing a key for a different action or changed
creation configuration is a conflict. Invalid transitions and unauthorized
requests never append a lifecycle event.

Lifecycle state does not claim that a participant process was interrupted or a
phase clock was frozen. Runtime supervision and phase-clock effects attach to
these accepted events in later features and must not silently invent success.

The browser setup feature is a separate inbound hexagon under
`apps/web/src/run-setup`. Pure validation owns field safety and local capability
availability; the HTTP adapter sends versioned configuration and lifecycle
intents. React owns only controlled interaction state. The operator bearer stays
in component memory and is never placed in configuration, URLs, browser storage,
or a `VITE_*` variable. Development requests use same-origin `/api`, which Vite
proxies to the loopback controller; production can provide a non-secret
`VITE_CONTROLLER_URL` for its trusted reverse-proxy topology.

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

The browser counterpart is a separate inbound hexagon under
`apps/web/src/events`. Its application state machine depends on transport and
delivery-decoder ports, so recovery rules have no React or Fetch dependency. A
Fetch streaming adapter supplies bearer authorization and `Last-Event-ID`
headers; the protocol adapter validates every frame with the shared strict
Version 1 parser. The composition factory is the only place that joins them.

The client advances its cursor only after accepting the next contiguous visible
delivery. It reconnects after closure, network failure, or a detected sequence
gap, suppresses exact at-least-once duplicates by event ID, and fails closed if
an event ID or prior sequence changes meaning. Connecting, live, recovering,
failed, and stopped are explicit observer states. The bearer remains outside
URLs and browser storage; a native `EventSource` is not used because it cannot
set the required authorization header.

## Live participant lanes v1

`apps/web/src/observatory` is a feature-oriented projection hexagon. Its pure
application reducer receives already-authorized live deliveries and owns the
stable four-lane state. React renders that state and the Observatory composition
subscribes through the event client; neither the lane domain nor its reducer
opens a network connection.

Run setup supplies stable participant order, adapter selection, execution mode,
and declared model text. Public briefing events add assignment IDs, runtime-start
events add validated runtime metadata and negotiated capabilities, event context
updates phase, and captured work adds the latest reported commit. Pause/resume
preserves the last factual activity; integration can mark an explicitly reported
quarantine; cancellation or completion finishes every lane.

Container health is unavailable until a controller event reports it. Runtime
startup is not treated as proof of container health, and missing adapter
capabilities remain `Capabilities pending` or an explicit count rather than
invented observations. Lane order never follows event arrival order. Unknown,
malformed, foreign-participant, and repeated delivery updates cannot add or
reorder lanes.

## Observable workstream v1

The Workstream is a second pure projection under `apps/web/src/observatory`.
Its domain stores labelled activity items; its application layer translates
authorized deliveries and sanitizes untrusted display data; React renders only
the resulting plain-text model. The live composition sends each accepted
delivery independently to the lane and Workstream reducers, so neither depends
on the other's presentation state.

Recognized facts cover agent-authored work notes, provider summaries with full
provenance, commands, bounded terminal tails, relative file changes, local test
self-reports, public messages, controller-attributed commits, adapter-measured
usage, resource costs, and artifact digests. One source event may produce several
items, but every item retains its source event ID and delivery sequence. Exact
repeated or malformed deliveries cannot duplicate visible evidence.

The sanitizer removes terminal control sequences, rejects absolute, traversal,
empty-segment, oversized, and control-bearing filenames, normalizes text, and
bounds previews. Markdown, HTML, SVG, and agent-authored link syntax remain
plain text and are escaped by React; no `dangerouslySetInnerHTML` path exists.
Artifact bodies never ride the event stream or render inline. The Workstream
shows validated SHA-256 references as load-on-demand records; CN-031 owns the
authorized artifact fetch and exact evidence inspector.

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

### Subprocess runtime adapter

`packages/adapters/src/subprocess` is a feature-oriented hexagon. Its domain
layer owns configuration and the strict NDJSON wire contract; its application
layer owns lifecycle, request correlation, capability enforcement, observations,
usage, interruption, and normalized reports. Only the Node outer adapter imports
`node:child_process`; the public factory wires it to the process-neutral port.

One persistent child belongs to one participant session. Stable request IDs and
one pending operation prevent response misattribution. Process stdout is reserved
for protocol frames, ordinary stdout and status are typed Tier 0 observations,
stderr becomes bounded Tier 0 evidence, and declared Tier 1 observations remain
labelled. Returned commands stay unknown until the controller parses and
authorizes them through the protocol and capability boundaries.

### Direct reference model loop

`packages/adapters/src/reference-loop` is a separate feature-oriented hexagon.
The provider-neutral domain port and strict response/configuration rules do not
depend on a provider SDK. Its application service owns session lifecycle, private
deliveries, deterministic turn timing, token budgets, interruption, usage, and
observable output. Provider implementations remain outer adapters.

Tier 0/1 and Tier 2 records share the common runtime observation stream. The
Tier 2 union admits only `provider_usage` labelled `provider_reported` and
`provider_reasoning_summary` labelled `provider_supplied`; runtime parsing also
enforces that pairing. This keeps the optional summary comparable without
presenting it as private chain-of-thought or trusted controller evidence.

### Heterogeneous match composition

The three-round acceptance composition keeps runtime choice and execution mode
as independent ports. Each participant session pairs one adapter with one
matching isolated execution boundary; the adapter's declared mode must equal the
inspected container manifest before work is accepted. Reference-loop sessions
exercise split workers, while deterministic contract sessions exercise contained
workers and their brokers in the reproducible end-to-end fixture.

Only an allow-listed fixture write command enters the execution boundary. The
participant container produces the changed bytes, the controller compares them
with the command, and only then writes them into the participant Git workspace
for the normal integration path. `EventLedgerRuntimeSessionAudit` records the
existing public `runtime.started` fact with round, participant, session, and the
common runtime descriptor; credentials and container-local details stay out of
that event. Adapter selection is therefore comparable without pooling split and
contained modes.

## Split-runtime container boundary

`apps/controller/src/containers` is a feature-oriented hexagon. The domain layer
owns image, identity, namespace, filesystem, resource, label, and audit-manifest
rules. The application supervisor depends on a process-neutral container-engine
port and owns transactional startup, readiness verification, bounded command
execution, freeze/thaw, and cleanup. Only the Docker outer adapter translates
that profile into CLI arguments or parses engine inspection records; it invokes
the CLI directly without a host shell.

The host worktree is a participant-specific read-only seed, not the live writable
workspace. The non-root container copies it into bounded tmpfs and performs all
repository and shell work there. Home and temporary storage are separate bounded
tmpfs mounts. Before returning a manifest, the supervisor compares Docker's
observed state with the complete requested policy. A mismatch rolls back the
container. Timeout or output overflow also destroys the worker so an abandoned
`docker exec` cannot continue consuming resources. The returned manifest records
the split mode and immutable image digest but never serializes host paths.

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

## Trusted investigation requests v1

`apps/controller/src/investigation` coordinates public CI, provenance inspection,
targeted audits, and full patch audits through authorization, shared-budget,
executor, artifact, and journal ports. The application service contains no
constitution branch: its authorizer supplies an approved ID and validated result
visibility. Only then does the service spend the matching Section 13 cost.

Budget and executor IDs are deterministic hashes of the participant command ID.
An exact completed retry returns its saved receipt before authorization, spending,
or execution. A failed job records a visibility-scoped terminal fact without its
internal error and is not rerun. Credits remain spent because trusted work was
attempted. The current fake executor caches successful stable job IDs; disposable
trusted-test execution replaces that adapter later.

Result bytes live in the artifact store with authorization-selected visibility.
The terminal event cites their digest and carries the same visibility, so clean
observers cannot infer participant-private result content. The public budget event
still shows that the team spent shared credits. Stored receipts and authorizer
output are runtime-validated before use; malformed visibility fails closed.

## Round evidence packet v1

`packages/core/src/evidence-packet.ts` is a pure read-model projector over accepted
event envelopes. It validates the requested run and round, validates every source
envelope, rejects foreign-run or duplicate-sequence input, and applies the shared
visibility projector before reading payloads. Known evidence payloads are parsed
from `unknown`; unrelated visible event kinds remain available as citation targets
but do not create invented facts.

The packet groups attributed work and line provenance, normalized patch digests,
integration conflicts, trusted investigation results, recorded expenditures,
participant claims, citation status, and unfulfilled commitments. It uses source
sequence only for deterministic internal ordering. Consumers receive stable event
IDs and timestamps, never ledger sequence numbers, so omitting sealed events does
not expose their positions. A citation is valid only when its complete target event
is visible to the packet audience; hidden and absent targets are both `missing`.

Projection is capped at 1,000 source events, 256 facts per section, and 256 KiB of
serialized output. Exceeding a bound is an explicit error rather than silent
truncation. Evidence grades describe provenance—recorded, attributed, trusted, or
claimed—but the schema deliberately has no suspicion, role, or verdict field.
Private beliefs and Town Hall arguments consume this factual boundary instead of
adding inference to it.

## Private belief reporting v1

`packages/core/src/beliefs.ts` owns the deterministic report contract. A valid
active roster contains the reporter and at least one other participant. The
report allocates one integer point value from 0 through 100 to every other active
participant exactly once, totals exactly 100, and cites one strongest evidence
event. Canonical participant-ID ordering makes replay and retry comparison
independent of submitted allocation order. Runtime parsing rejects unknown fields.

`apps/controller/src/beliefs` is the persistence hexagon. The application service
reads current round, phase, and active roster through a context port; accepts new
reports only in the matching `belief` phase; and asks an evidence port whether the
citation was visible to the reporter in that round. Hidden, foreign, wrong-round,
and nonexistent evidence all produce the same unavailable result.

The event-ledger journal stores an accepted report as `belief.reported`, with the
participant as actor, `participant_private` visibility naming only that reporter,
and the strongest evidence ID as its parent event. Exact command retries return
the recorded report even after the phase moves forward. The shared projector
keeps it out of other participants and Clean spectator replay while sealed, then
admits it to research replay after reveal. Public ballots remain separate events.

## Bounded Town Hall v1

`packages/core/src/town-hall.ts` owns a pure two-pass discussion state machine.
The active roster is also the immutable speaking order. Every participant receives
one evidence/accusation turn followed by one defence/rebuttal turn; an explicit
yield consumes the opportunity without inventing speech. Typed state exposes the
current pass, speaker, and remaining allowance. After the final rebuttal turn the
discussion is terminal. Stable turn IDs make exact replay idempotent and reject
changed reuse.

Messages preserve their free-form text but must be nonblank and at most 4,096
UTF-8 bytes. A message may cite up to eight unique event IDs and declare the event
kind it claims to reference. The caller supplies an index built only from events
visible to that speaker at that time. An exact ID/kind match is `valid`; a visible
ID with a different kind is `mismatched`; anything unavailable is `missing`.
Results never include the actual kind behind a mismatch, and hidden and absent
IDs are indistinguishable. Town Hall output is discussion evidence only; motions,
ballots, and sanctions cross the separate typed governance boundary.

## Constitution-driven governance v1

The governance core is split by behavioral ownership. `governance-types.ts`
defines motions, rules, ballots, effects, and state; `governance.ts` validates
state, opens authorized motions, snapshots electorates, and accepts sealed votes;
`governance-ballot.ts` closes ballots, publishes choices, and applies passed
effects. None imports a controller, clock, database, or constitution preset.

A motion rule selects an active participant, the sanctioned target, or a named
office holder as proposer; selects all active voters, active non-authors, or active
voters excluding the target; and specifies a fixed approval count or simple
majority. The electorate and threshold are fixed when the ballot opens. One ballot
is open at a time. Exact votes retry after the deadline without changing state;
changed votes conflict. An early close requires every eligible submission; a
deadline close turns each absence into an unsubmitted abstention.

Open-ballot public projection includes the motion, electorate, threshold,
deadline, and number submitted but never choices. Closure publishes all choices
and a passed or rejected result separately from private beliefs. Passed effects
cover audit authorization, patch disposition, participant status, and office
holder changes. External work such as spending credits, executing an audit, or
reverting Git remains pending until its controller port succeeds.

A participant appeal references the exact passed quarantine motion and includes a
bounded statement. Its constitution rule must grant proposal authority to the
quarantined target; only active players enter the appeal electorate. A sanction
can be appealed once, including when that appeal is rejected.

## Open Merge constitution v1

`packages/core/src/constitutions/constitution.ts` defines the common preset shape:
patch authority, direct paid actions, participant quarantine and appeal policy,
offices, and the generic governance rules. Presets are immutable data consumed by
the shared engine and orchestration; callers do not branch on display names.

`open-merge.ts` is the weak-governance baseline. It automatically authorizes only
known patches that the upstream proposal boundary has validated and that remain
in `submitted` state. Authorization follows recorded state order and changes the
governance disposition to `accepted`; the mechanical integrator still records
integrated, no-change, ancestry rejection, or conflict outcomes. Open Merge has no
ballots or offices and forbids participant quarantine and appeal.

Trusted public CI, provenance inspection, targeted audit, full audit, and revert
remain direct actions against the shared governance budget. Their existing ports
must spend credits and execute the action before recording completion. The preset
grants authority only; it does not bypass budget accounting or claim an external
effect succeeded.

## Council constitution v1

`packages/core/src/constitutions/council.ts` is the default peer-governance preset.
It has no direct paid actions or offices. Every decision enters the shared sealed
ballot engine. An accept-patch motion snapshots active non-authors and requires two
endorsements. Audit, delay, reject, patch quarantine, and revert motions snapshot
all active participants and require a simple majority. Participant quarantine also
includes all active participants, including the target, and requires exactly three
approvals; the threshold does not weaken when active membership shrinks.

A passed quarantine changes the target to inactive governance status. That target
may submit one bounded appeal statement tied to the exact sanction, but only the
remaining active participants enter its majority ballot. Rejection consumes the
appeal right. The target cannot vote because quarantine removes voting authority.

Audit motions include the exact budget action, so their passed effect feeds the
existing cost table without interpreting text. Passed reverts map to the separate
two-credit `revert_patch` action. In both cases, ballot passage is authorization;
the controller must atomically spend credits before executing and recording the
external result.

## Elected Maintainer constitution v1

`ranked-election.ts` validates one complete ranking from every active participant.
It counts each ballot's highest remaining candidate, elects a strict majority, and
otherwise eliminates the lowest count. When lowest counts tie, the greatest stable
participant identifier is eliminated. Candidate and count output is sorted by ID,
so roster and ballot arrival order do not affect replay.

`elected-maintainer.ts` installs the winner into the named `maintainer` office.
Only its active holder may order the complete set of submitted patches and directly
authorize a targeted audit. That audit still enters the shared budget before its
trusted job runs. A full patch audit is available only through an active-player
simple-majority ballot.

Replacing the office holder or quarantining the current holder requires exactly
three approvals. Constitution rule restrictions reject quarantine motions aimed
at anyone else. The office grants no appeal right and explicitly grants no private
evidence; it may be held by any elected participant, including the saboteur. Office
actions authorize later controller effects and do not directly mutate Git or
artifact storage.

## Three-round completion and resolution v1

`packages/core/src/match-resolution.ts` owns the deterministic Section 14 score
formula and validates every bounded component before calculating team and
saboteur utilities. It publishes the component values alongside the combined
scores and classifies failed release, successful defence, and successful
sabotage without treating a covert condition as a win when required tests fail.

`apps/controller/src/matches` coordinates exactly three rounds through the shared
phase reducer. Its application service depends on lifecycle, private briefing,
round execution, candidate freezing, scenario scoring, and journal ports. Each
round begins from the previous integrated candidate. After the third integration
enters completion, the Git freezer requires a clean exact revision and hashes its
deterministic archive before either scorer runs. The isolated evaluator introduced
later must materialize that same content identity inside its trusted container.

The ledger journal records every phase transition, round work result, integration,
candidate identity, separate legitimate and covert result, role reveal, component
scoreboard, and terminal completion. Host candidate paths never enter events.
Phase, work, integration, frozen-candidate, and terminal facts are public; hidden
aggregates, covert detail, roles, and scores remain `post_reveal`. The application
records role reveal before calculating and publishing final scores.

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

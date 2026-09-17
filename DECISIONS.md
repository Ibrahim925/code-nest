# Design Decisions

## 2026-09-17: Use feature-oriented hexagonal boundaries

- Reason: controller capabilities must remain testable without Fastify, SQLite,
  Docker, or a specific runtime while still keeping related code discoverable.
  Domain rules and application use cases therefore depend inward on narrow ports,
  with transport and persistence implemented as adapters.
- Rejected alternative: global `controllers`, `services`, and `repositories`
  folders scatter one capability across the application. Requiring an interface
  for every helper adds indirection without isolating a real side effect.
- Constraint: organize hexagonal layers within each feature, create ports only
  at external or replaceable boundaries, wire implementations in composition
  roots, and colocate narrow tests with the layer whose behavior they verify.

## 2026-09-17: Derive run lifecycle state from audit events

- Reason: create, pause, resume, and cancel must be durable and replayable, and
  the event ledger already commits each idempotent operator command atomically.
  Folding four strict event kinds makes the acknowledged audit history and the
  inspected run state the same fact.
- Rejected alternative: a separate mutable run-state table would need a schema
  migration and an atomic dual write with the ledger before it provides any
  behavior the first lifecycle slice needs.
- Constraint: `run.created` is the first event. Lifecycle payloads are exact,
  transitions are validated both before append and during replay, and later
  runtime or clock side effects must attach to accepted lifecycle events without
  rewriting them.

## 2026-09-17: Snapshot scenario files during manifest verification

- Reason: validating a digest and later reopening the named file leaves time for
  its contents to change. Keeping the bytes that passed verification gives run
  setup an exact input and preserves the matching manifest digest for replay.
- Rejected alternative: trusting paths after one preflight check makes the run
  depend on mutable local files. Copying before validation would preserve the
  wrong bytes just as faithfully.
- Constraint: scenario consumers use the loaded byte snapshot. Git workspaces are
  created from the verified full commit ID, and container images use digest-pinned
  names. Paths are diagnostic metadata, not authority after the load completes.

## 2026-09-17: Store artifacts as immutable SHA-256 objects

- Reason: large evidence must survive restart without filling SQLite event rows.
  A digest binds a citation to the exact bytes that were inspected.
- Rejected alternative: inline event payloads make replay and live delivery carry
  logs repeatedly. Mutable named files allow a later write to alter old evidence.
- Constraint: publish bytes before per-run metadata; never derive a path from a
  submitted filename; verify the digest and size on every authorized read. One
  run cannot reclassify an existing digest.

## 2026-09-17: Project visibility by omitting whole events

- Reason: one event has one visibility tag. Returning either its complete saved
  envelope or nothing keeps live delivery and replay deterministic.
- Rejected alternative: browser filtering sends secrets across the boundary.
  Field-by-field redaction can also leave event kinds, sequence metadata, or new
  payload fields behind when schemas change.
- Constraint: authenticated server state supplies the audience, run ID, and
  reveal state. Mixed-sensitivity facts are split before persistence.
  Operator-private events never enter an observer replay, even after role reveal.

## 2026-09-17: Store controller events in SQLite WAL

- Reason: the Observatory, replay, and restart recovery all need the same ordered
  history. SQLite gives the local controller atomic sequence assignment and
  command deduplication without adding a database service.
- Rejected alternative: JSON Lines can preserve events but can't atomically bind
  a command receipt to a sequence. PostgreSQL adds deployment work before the
  local research demo needs concurrent writers.
- Constraint: use the SQLite 3.53.4 library bundled with the pinned Node 24
  runtime; keep the database on a local filesystem in WAL mode; the controller is
  the sole writer. Schema version 1 maps one command to one result event.

## 2026-09-17: Publish strict JSON Schema envelopes from one protocol package

- Reason: model- and harness-agnostic adapters need a wire contract that can be
  runtime-validated outside TypeScript while the reference implementation still
  receives inferred static types.
- Rejected alternative: TypeScript-only interfaces cannot validate subprocess or
  network input; handwritten duplicate types and validators would drift.
- Constraint: `typebox@1.3.30` is exact-pinned in `@code-nest/protocol`; v1
  control objects reject unknown fields; breaking control or visibility changes
  require a new version; capability credentials remain outside command bodies.

## 2026-09-16: Use one TypeScript workspace for the reference implementation

- Reason: shared types reduce drift across the controller, protocol, replay
  projector, and browser while keeping the first release approachable.
- Rejected alternative: Python controller plus TypeScript UI would duplicate
  contracts and introduce a second build and testing system.
- Constraint: participant adapters must still be implementable in any language.

## 2026-09-16: Keep the control plane outside participant containers

- Reason: roles, covert scoring, integration, credentials, and Docker authority
  must not be readable or writable by participant agents.
- Rejected alternative: an all-in-one container would collapse the trust boundary.
- Constraint: untrusted workers receive narrow capabilities, never host authority.

## 2026-09-16: Make the event ledger the source of observable match history

- Reason: live viewing, evidence inspection, recovery, and offline replay need one
  ordered, durable record.
- Rejected alternative: deriving history from process logs loses semantic actions
  and cannot enforce visibility reliably.
- Constraint: commit accepted events before broadcasting them; project UI state
  deterministically and tolerate duplicate SSE delivery.

## 2026-09-16: Do not claim access to private chain-of-thought

- Reason: internal reasoning is neither consistently available nor comparable
  across providers.
- Rejected alternative: presenting provider traces as agent thoughts would create
  misleading evidence and compromise runtime neutrality.
- Constraint: show observable actions and labelled self-reports; provenance is
  mandatory for optional provider reasoning summaries.

## 2026-09-16: Use synthetic space-station access control as the flagship scenario

- Reason: permissions yield objective hidden conditions and subtle, consequential
  sabotage, while a station map makes the outcome immediately understandable.
- Rejected alternative: Snake remains suitable as a tutorial, but collision or
  scoring bugs produce weaker governance evidence.
- Constraint: covert goals specify outcomes, vary their hidden condition, require
  substantial legitimate completion, and never target a real system.

## 2026-09-16: Ship locally before considering remote execution

- Reason: local operation is sufficient for a credible research demonstration
  without pretending Docker is a hostile multi-tenant security boundary.
- Rejected alternative: a cloud-first system adds identity, tenancy, billing, and
  infrastructure risks unrelated to the core experiment.
- Constraint: bind to loopback by default; remote exposure requires a new threat
  model and explicit approval.

## 2026-09-16: Pin compatible releases instead of accepting newest tags

- Reason: TypeScript 7.0.2 exceeded TypeScript ESLint's supported peer range,
  while TypeScript 6.0.3 satisfies the current range and passes every check.
- Rejected alternative: suppressing peer warnings would make the verification
  environment unsupported on its first day.
- Constraint: dependencies use exact manifest versions and one shared lockfile;
  upgrades must pass the peer audit and `make check`.

## 2026-09-16: Allow only esbuild to run an install script

- Reason: Vite and tsx require esbuild's platform-binary setup, while pnpm 12
  correctly blocks unreviewed dependency scripts by default.
- Rejected alternative: globally allowing dependency scripts expands the
  supply-chain execution surface without a present need.
- Constraint: `pnpm-workspace.yaml` is the reviewed build-script allow-list;
  additions require explicit review.

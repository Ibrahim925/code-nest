# Progress Log

Session state for agents. Read this at session start and update it before ending
any session that changed code. Record only what a command or human review
actually verified.

## Startup Readiness Checklist

- Setup: `make setup` | Dev: `make dev` | Test: `make test` | Verify: `make check`
- Environment: Node 24.21.0, pnpm 12.4.2, exact dependencies locked, Vitest
  configured, and the harness smoke test passing.
- Structure: runnable controller, web, protocol, core, adapters, and testing
  workspaces exist; see `AGENTS.md`.

## Current Verified State

- **Branch/commit:** `main`; `CN-009` is the latest verified feature checkpoint.
- **Verification status:** `CN-009` is passing. Focused capability and durable
  audit verification passed 20 of 20 tests. `make check` passed with ESLint,
  strict typechecks across six workspaces, 13 Vitest files, and 127 tests.
- **Start:** run `make dev`; controller is at `http://127.0.0.1:3100` and the
  web scaffold is at `http://127.0.0.1:5173`.
- **Next priority:** begin `CN-010`, the runtime adapter contract and deterministic
  fake adapter. Negotiate only declared observability, keep provider/runtime
  details outside core rules, and pass parsed participant commands through the
  capability authority before accepting state changes.
- **Blockers:** none.

## Session Records

### 2026-09-17 (cn-009) — Add scoped participant capabilities

- Outcome: done.
- Did: added a feature-oriented authorization hexagon with pure scope rules, an
  application capability authority, a narrow audit port, and a SQLite-ledger
  audit adapter. Tokens use opaque 256-bit random bearer material, retain only a
  SHA-256 digest in memory, reserve operator/observer credentials, bind run,
  participant, allowed actions, and expiry, reject per-run command replay across
  token rotation, and support immediate token or run revocation. Issue, reject,
  and revoke evidence is operator-private and built without bearer material.
- Verification run: observed the focused suite fail before the capability module
  existed. Final focused verification passed 20 of 20 tests. Pinned Node 24.21.0
  directly verified 50-byte base64url bearer generation, 32-byte SHA-256 output,
  and equal-length timing-safe comparison because Context7 was unavailable in
  this session. Final `make check` passed ESLint, all six workspace typechecks,
  13 test files, and 127 tests.
- Risks / follow-ups: grants deliberately fail closed on controller restart and
  must be reissued when participant sessions recover. The audit adapter refuses
  nonexistent runs to avoid phantom run state. CN-010 and the later participant
  command gateway must call this service only with protocol-validated envelopes
  and map every detailed denial to the generic participant-facing message.

### 2026-09-17 (cn-008) — Build reconnectable audience-safe SSE

- Outcome: done.
- Did: added a feature-oriented events hexagon with an application stream
  service, historical/subscription source port, SQLite-ledger adapter, Fastify
  SSE adapter, and composition-root wiring. Added distinct operator and clean
  observer authentication, visible-cursor validation, subscribe-before-catch-up
  buffering, committed-event publication, heartbeats, disconnect cleanup, and
  retry-safe live delivery. Added an approved Version 1 delivery schema whose
  audience-contiguous sequence replaces the private ledger sequence on the wire;
  stable event IDs drive `Last-Event-ID` reconnection.
- Verification run: focused protocol, application, and HTTP suites passed 21 of
  21 tests. The ledger integration test proves subscribers can read the event
  from durable storage and idempotent retries do not republish it. Final
  `make check` passed ESLint, all six workspace typechecks, 11 test files, and
  107 tests.
- Risks / follow-ups: Version 1 subscriptions are process-local and slow clients
  reconnect after response-buffer overflow. Resolving an observer cursor scans
  prior events to reconstruct its visible ordinal; a persisted audience index
  or multi-process broadcaster can replace the source adapter later without
  changing the delivery contract.

### 2026-09-17 (architecture) — Adopt feature-oriented hexagonal boundaries

- Outcome: done.
- Did: refactored the run lifecycle into a framework-free domain, application
  use cases with inbound and persistence ports, a SQLite event-ledger adapter,
  a Fastify HTTP adapter, and explicit composition-root wiring. Added direct
  domain coverage and documented when to use hexagonal layers without creating
  interfaces for pure helpers. Codified colocated unit and narrow integration
  tests as the default, with cross-package, end-to-end, isolation, and scenario
  tests kept in their higher-level owning suites.
- Verification run: baseline `make check` passed 8 files and 93 tests before the
  refactor. The focused domain and HTTP suites passed 11 of 11 tests afterward.
  Final `make check` passed ESLint, all six workspace typechecks, nine test files,
  and 96 tests.
- Risks / follow-ups: apply ports at external or genuinely replaceable
  boundaries, not around every function. CN-008 should follow the same inward
  dependency direction for stream subscriptions and event delivery.

### 2026-09-17 (cn-007) — Build the run lifecycle API

- Outcome: done.
- Did: added bearer-authenticated create, inspect, pause, resume, and cancel HTTP
  endpoints; exact request validation; explicit `operator_cancelled` terminal
  state; public audit events; constant-time token comparison; historical
  idempotency replay; cross-action key reuse rejection; concurrent transition
  protection; event-derived restart recovery; safe boundary errors; and shutdown
  cleanup. Added a read-only command-result lookup to the existing ledger but no
  database schema, protocol envelope, or dependency change.
- Verification run: observed all 7 initial route cases fail before implementation;
  final focused verification passed 8 of 8 tests against real temporary SQLite
  files. Final `make check` passed ESLint, all six workspace typechecks, eight
  test files, and 93 tests.
- Risks / follow-ups: Version 1 creation takes a caller-supplied stable run ID;
  CN-027 will own full scenario and adapter setup. Lifecycle events record
  accepted control state only; CN-010 and later controller coordination must
  attach real interrupt, token-revocation, clock, and cleanup effects without
  claiming they happened before confirmation.

### 2026-09-17 (cn-006) — Build the scenario manifest loader

- Outcome: done.
- Did: added strict Version 1 manifest parsing, full Git commit verification,
  OCI image pins, bounded reads, SHA-256 verification, lexical and canonical path
  containment, distinct file enforcement, exact manifest-byte hashing, retained
  asset snapshots, resource ceilings, and stable field-specific errors. No package
  was added and no database or protocol contract changed.
- Verification run: observed the focused suite fail on the missing loader before
  implementation; the first implementation passed 31 of 32 cases and exposed one
  imprecise path field. Final focused verification passed 34 of 34 tests. Final
  `make check` passed ESLint, all six workspace typechecks, seven test files, and
  85 tests.
- Risks / follow-ups: each asset is capped at 16 MiB and the retained set at 64
  MiB. Later consumers must use the verified bytes, and CN-011 must create Git
  workspaces from `baseRevision`, never from the repository's mutable checkout.

### 2026-09-17 (cn-005) — Build the match phase state machine

- Outcome: done.
- Did: added typed active and completed match states, positive safe-integer round
  validation, the exact Section 12 transition order, integration-driven round
  rollover, stale-position rejection, terminal completion, and transition records
  for later ledger events. The reducer has no external effects or dependencies.
- Verification run: observed all 11 focused cases fail before implementation;
  final focused verification passed 11 of 11 tests. Final `make check` passed
  ESLint, all six workspace typechecks, six test files, and 51 tests.
- Risks / follow-ups: this reducer decides phase order only. The controller must
  decide when a transition is authorized, persist it atomically, and own clocks,
  pause/cancel behavior, runtime readiness, and phase-specific entry criteria.

### 2026-09-17 (cn-004) — Build the artifact store

- Outcome: done.
- Did: added a versioned, content-addressed artifact store with SHA-256 object
  paths, immutable per-run metadata, atomic no-replace publication, file and
  directory syncing, exact-size checks, owner-only files, and verified reads;
  reused CN-003's visibility predicate rather than duplicating access rules. No
  external dependency was added.
- Verification run: observed the focused suite fail before implementation; final
  focused verification passed 11 of 11 tests against real temporary directories.
  Final `make check` passed ESLint, all six workspace typechecks, five test files,
  and 40 tests.
- Risks / follow-ups: Version 1 accepts bounded byte arrays rather than streaming
  uploads. Producers must scrub secrets before persistence. The store permits
  global byte deduplication but forbids metadata reclassification within one run.

### 2026-09-17 (cn-003) — Build the visibility projector

- Outcome: done.
- Did: added a pure whole-event projector with typed participant, clean observer,
  unblinded observer, operator, sealed, and revealed contexts; enforced run
  matching and exact recipient IDs; kept operator-private events outside every
  observer mode; exported the projector through `@code-nest/core` and documented
  the server-owned trust boundary.
- Verification run: observed the focused suite fail before implementation; final
  focused verification passed 10 of 10 tests, including serialized no-leak and
  post-reveal operator-privacy cases. Final `make check` passed ESLint, all six
  workspace typechecks, four test files, and 29 tests.
- Risks / follow-ups: retained ledger sequences can reveal that omitted events
  exist. CN-008 must decide whether stable citation IDs are sufficient or whether
  audience-specific stream cursors are also needed. Event producers must split
  mixed-sensitivity facts before persistence.

### 2026-09-17 (cn-002) — Build the durable event ledger

- Outcome: done.
- Did: added a schema-versioned, three-table event ledger using the pinned Node
  runtime's built-in SQLite 3.53.4; made command receipt, sequence reservation,
  and event insertion one transaction; added validated catch-up reads and stable
  corruption/write errors; configured WAL and documented the single-writer local
  storage boundary. No third-party database package was added.
- Verification run: observed the focused suite fail before the ledger existed;
  final focused verification passed 7 of 7 tests against real temporary SQLite
  files. The rollback test forces an insertion failure after sequence reservation.
  Final `make check` passed ESLint, all six workspace typechecks, three test files,
  and 19 tests.
- Risks / follow-ups: Node's built-in SQLite API is still marked release candidate,
  so Code Nest pins Node 24. Version 1 maps one accepted command to one result
  event and supports a local single-controller writer only.

### 2026-09-17 (cn-001-start) — Start versioned protocol envelopes

- Outcome: done.
- Did: exact-pinned TypeBox in the protocol package; published strict JSON Schema
  2020-12 command and event envelopes with inferred TypeScript types; added
  non-throwing parsers, stable JSON-pointer errors, targeted visibility rules,
  and guards for process-local and cyclic payloads; documented compatibility.
- Verification run: observed the new suite fail before implementation; final
  focused verification passed 11 of 11 tests; protocol typecheck passed; final
  `make check` passed ESLint, all six workspace typechecks, two test files, and
  12 tests; JSON-serialized schemas were reconstructed and validated fixtures.
- Risks / follow-ups: kind-specific payload schemas remain deliberately outside
  the base envelope. `CN-002` must persist accepted envelopes without altering
  their bytes or sequence semantics.

### 2026-09-16 (phase-0) — Approve the build specification

- Outcome: done.
- Did: finalized the research/product specification; selected a full-TypeScript
  pnpm workspace with React/Vite, Fastify, SQLite, Vitest, and Docker; refined
  the first demonstration into a synthetic space-station access-control task.
- Verification run: user reviewed and approved the TypeScript stack and first
  scenario. No software checks existed or ran.
- Risks / follow-ups: exact dependency pins belong to Phase 2 and its lockfile.

### 2026-09-16 (phase-1) — Materialize the harness

- Outcome: done.
- Did: created the agent entry page, standard command surface, state files,
  decision record, and focused engineering topic documents.
- Verification run: structural and link inspection only. No dependency install,
  lint, typecheck, test, or development server was run.
- Risks / follow-ups: commands deliberately target the workspace that Phase 2
  will create; Context7 was unavailable during this phase.

### 2026-09-16 (phase-2) — Make the workspace runnable

- Outcome: done.
- Did: installed Node 24.21.0; created seven pnpm workspace projects; pinned
  runtime and verification dependencies; allow-listed only esbuild's required
  install script; added controller and web entry points plus one harness test.
- Verification run: `make setup` passed from the frozen lockfile; `make check`
  passed with ESLint, six workspace typechecks, and one of one tests; `pnpm
  peers check` found no issues; `make dev` served both local processes;
  `GET /health` returned `{"service":"code-nest-controller","status":"ok"}`
  and the web root returned its Vite HTML. Both stopped after the check.
- Risks / follow-ups: no product feature is implemented. TypeScript 7 was
  rejected because the selected TypeScript ESLint release supports versions
  below 6.1; revisit the pin only when the peer range supports it.

### 2026-09-16 (phase-3) — Compile the implementation schedule

- Outcome: done.
- Did: compiled the specification into 48 ordered features across five
  milestones. Every row has one observable behavior, exact verification,
  `not_started` state, empty evidence, and scope for one focused session.
- Verification run: parsed `feature_list.json`; checked unique ordered IDs,
  allowed state values, required fields, WIP count, and milestone ordering;
  reran `make check`.
- Risks / follow-ups: the third scenario domain and scoring remain an explicit
  pre-implementation review; no feature was started during initialization.

### 2026-09-17 (phase-4) — Create the initialization checkpoint

- Outcome: done.
- Did: added Node/TypeScript and Code Nest runtime ignore rules; initialized Git
  on `main`; staged one atomic baseline; created the `chore: initialize agent
  harness` checkpoint.
- Verification run: `make setup` passed from the frozen lockfile; the feature
  tracker validation reported 48 unique ordered features, zero WIP, and only
  `not_started` states; `make check` passed with ESLint, six workspace
  typechecks, and one of one tests; staged whitespace/secret checks passed; the
  final working tree was clean.
- Risks / follow-ups: implementation is deliberately absent except for the
  minimal runnable entry points and harness smoke test. Start feature work in a
  fresh session at `CN-001`.

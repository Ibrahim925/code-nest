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

- **Branch/commit:** `main`; `CN-004` is the latest verified feature checkpoint.
- **Verification status:** `CN-004`'s focused suite passed 11 of 11 tests;
  `make check` passed with ESLint, strict typechecks across six workspaces, five
  Vitest files, and 40 tests.
- **Start:** run `make dev`; controller is at `http://127.0.0.1:3100` and the
  web scaffold is at `http://127.0.0.1:5173`.
- **Next priority:** begin `CN-005`, the deterministic match-phase state machine.
  Fix transition, rejection, terminal, and replay rules before implementation.
- **Blockers:** none in `CN-004`. This Codex task retains the pre-rename sandbox
  path; reopen the project from `code-nest` so future cache-writing commands use
  the correct workspace permission without extra approval.

## Session Records

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

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

- **Branch/commit:** `main` at the `chore: initialize agent harness`
  initialization checkpoint.
- **Verification status:** `make setup` passed with the frozen lockfile;
  `make check` passed (ESLint, strict typechecks across six workspaces, one
  Vitest file and one test); `pnpm peers check` reported no issues.
- **Start:** run `make dev`; controller is at `http://127.0.0.1:3100` and the
  web scaffold is at `http://127.0.0.1:5173`.
- **Next priority:** begin a fresh implementation session with `CN-001`,
  Versioned command and event envelopes. Mark only that row `in_progress`,
  implement it test-first, and require its listed verification before passing.
- **Blockers:** none in the repository. This Codex task retains the pre-rename
  sandbox path; reopen the project from `code-nest` so future cache-writing
  commands use the correct workspace permission without extra approval.

## Session Records

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

# AGENTS.md

> Entry point for AI agents working in this repository. Read this first, then load
> only the topic documents relevant to the current task.

## Overview

Code Nest is a local research environment where four autonomous coding agents
collaborate on a real repository while one privately attempts a subtle sabotage.
Success means reproducible matches, strict information boundaries, observable
governance, and deterministic replay—not merely convincing agent conversation.

The authoritative product contract is `SPEC.md`; `PRODUCT.md` summarizes its
users and experience. Initialization is separate from feature implementation.

## Stack

- Node.js 24.21.0 LTS with pnpm 12.4.2 workspaces.
- TypeScript 6.0.3 in strict mode across all first-party packages.
- React 19.3.0 with Vite 8.3.0 for the Live Observatory.
- Fastify 5.12.4 for the local controller's HTTP and SSE interfaces.
- SQLite for durable match state and the append-only event ledger.
- Vitest for unit, integration, and deterministic replay tests.
- Docker for disposable participant and trusted-test execution.

Participant runtimes remain language-, harness-, provider-, and model-agnostic.

## Quick start

- Setup:  `make setup`
- Dev:    `make dev`
- Test:   `make test`
- Verify: `make check` — lint, typecheck, and tests

## Project structure

- `apps/controller/` — trusted API, game controller, projector, and operators.
- `apps/web/` — Live Observatory and replay interface.
- `packages/protocol/` — versioned commands, events, visibility, and schemas.
- `packages/core/` — deterministic game rules, scoring, and constitutions.
- `packages/adapters/` — process-neutral participant runtime boundary.
- `packages/testing/` — fixtures and cross-package test utilities.
- `scenarios/` — synthetic task repositories, briefs, tests, and scorers.
- `docs/` — focused engineering rules loaded on demand.

Do not invent a competing structure without approval.

## Session workflow

**Clock in:**

1. Read `PROGRESS.md` for verified state, blockers, and the next priority.
2. Read `DECISIONS.md` for load-bearing rationale.
3. Run `make check` and confirm the repository starts consistent.
4. Continue the sole `in_progress` feature, or select the first `not_started` one.
5. Load only the topic documents relevant to that feature.

**Clock out after changing code:**

1. Update `PROGRESS.md` with the outcome and exact verification performed.
2. Update `feature_list.json`; never mark unverified work `passing`.
3. Run `make check`; remove debug code and stray artifacts.
4. Commit one coherent, verified change.

## Definition of Done

A change is done only after its checks actually run:

1. Formatting, lint, and strict typecheck pass through `make lint`.
2. Unit and integration tests pass through `make test`.
3. Cross-component work passes its specified user-flow or replay check.
4. Security-sensitive work also passes the relevant isolation or leakage check.

Report what ran, what passed, and what was skipped. Skipped is never passing.

## Work rules

- WIP = 1: only one feature may be `in_progress` at a time.
- Keep trusted control-plane code separate from untrusted execution code.
- Events and protocol schemas are compatibility contracts, not internal details.
- Prefer deterministic pure logic in `packages/core`; isolate side effects.
- Use current Context7 documentation before library- or framework-specific work.
- Preserve unrelated user changes and keep patches narrowly scoped.

## Boundaries

- **Always:** run `make check` before committing; preserve role and hidden-test
  visibility; record state changes as durable events; sanitize untrusted output.
- **Ask first:** dependencies, database schemas, protocol compatibility, CI,
  scenario scoring, new stack choices, remote exposure, or weaker isolation.
- **Never:** commit secrets; expose chain-of-thought as ground truth; mount the
  Docker socket into participant containers; leak hidden tests or covert briefs;
  delete or weaken a failing test merely to make a check green.

## Topic docs

- `docs/architecture.md` — read when changing packages or control-plane boundaries.
- `docs/protocol-and-events.md` — read when adding commands, events, or visibility.
- `docs/runtime-isolation.md` — read for Docker, adapters, credentials, or tests.
- `docs/testing.md` — read before writing or changing any verification.
- `docs/code-style.md` — read before adding TypeScript source.
- `docs/observatory-ui.md` — read for live, replay, accessibility, or observer UX.
- `docs/scenarios.md` — read for task repositories, covert goals, or scoring.

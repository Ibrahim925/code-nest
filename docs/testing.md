# Testing Strategy

> Read this before adding behavior, changing verification, or deciding whether a
> feature may move to `passing`.

## Test layers

1. Unit tests cover pure game rules, visibility, scoring, budgets, constitutions,
   schema parsing, and projection.
2. Integration tests cover SQLite transactions, HTTP/SSE behavior, Git
   integration, adapter processes, artifact storage, and recovery.
3. Isolation tests exercise real disposable containers and forbidden access.
4. Scenario tests run frozen task repositories with public and hidden scorers.
5. User-flow tests cover starting, observing, reconnecting, revealing, and
   replaying a match.

Keep most rule coverage below Docker and browser layers so failures are fast and
diagnostic. Do not mock the component whose boundary the test claims to verify.

## Determinism

Inject clocks, random seeds, IDs, and external effects. A completed replay must
render and score without a model, Docker, provider, or network call. Store
fixtures with explicit protocol versions and stable event order.

## Security cases

Every visibility or capability feature needs positive and negative tests.
Include malformed, duplicate, concurrent, late, and unauthorized commands.
Hidden information tests inspect serialized responses and replay bundles, not
only what the interface visibly renders.

## Commands and evidence

- `make lint`: formatting, lint, and strict typecheck.
- `make test`: the default repeatable test suite.
- `make check`: aggregate completion gate.

Feature-specific verification belongs in `feature_list.json`. Record exact
commands and results in `PROGRESS.md`. Never mark a feature `passing` because
the implementation looks correct.

## Test quality rules

- Name the behavior and consequence, not the implementation function.
- Assert externally meaningful output and durable state.
- Use one intentional reason for failure per test where practical.
- Never weaken, skip, or delete a failing test without explaining the changed
  requirement and receiving approval when it affects scope or security.

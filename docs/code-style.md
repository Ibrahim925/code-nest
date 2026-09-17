# TypeScript Code Style

> Read this before adding TypeScript source or reviewing a cross-package change.
> The example below is the tested entry point in `packages/core/src/index.ts`.

## Preferred shape

```ts
export interface HarnessStatus {
  project: "code-nest";
  ready: true;
}

export function describeHarness(): HarnessStatus {
  return {
    project: "code-nest",
    ready: true,
  };
}
```

## Rules

- Use strict TypeScript. Do not introduce `any`; parse `unknown` at boundaries.
- Prefer small named functions and discriminated unions over boolean bundles.
- Make illegal or private states difficult to represent.
- Keep core functions deterministic; inject clocks, IDs, randomness, storage, and
  process execution.
- Use domain names from the specification: run, match, participant, constitution,
  event, artifact, candidate, builder, and saboteur.
- Errors crossing a boundary use stable machine codes plus safe human messages.
- Preserve original failures as internal causes without leaking secrets to users.
- Avoid framework objects in `packages/core` and `packages/protocol`.
- Comments explain constraints or non-obvious rationale, not line-by-line syntax.

## Imports and files

Use package public entry points across workspace boundaries. Avoid deep imports
into another package's internals. One file should have one dominant concern;
split a file when unrelated state machines or boundary adapters accumulate.

Generated schemas, replay fixtures, lockfiles, and vendored scenario repositories
are changed through their owning generator or documented workflow, never by
hand.

## Review checklist

- Is untrusted input validated at runtime?
- Can a hidden field accidentally serialize through object spreading?
- Does the name describe a domain fact rather than a framework mechanism?
- Is the behavior testable without Docker, a browser, or a model where possible?
- Does the error tell the next agent what failed and how to investigate it?

# Design Decisions

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

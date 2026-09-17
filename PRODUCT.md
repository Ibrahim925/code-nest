# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Code Nest uses a full-TypeScript pnpm workspace. The Live Observatory is built with React and Vite; the local controller uses Fastify for authenticated HTTP commands and Server-Sent Events; SQLite stores the append-only event ledger and derived match state; and Vitest covers unit, integration, and deterministic replay behavior. Node.js and container images are pinned by the repository. Participant agents remain language-, runtime-, harness-, and model-agnostic through a typed wire protocol.

## Users

The primary user is an AI researcher or engineer running controlled experiments with autonomous coding agents. They need to start a match, watch work as it happens, inspect the evidence available to each participant, and compare outcomes across models, runtimes, and governance rules.

A second audience watches saved runs: supervisors reviewing an experiment, students learning how multi-agent systems behave, and researchers inspecting a failure without rerunning an expensive match.

## Product Purpose

Code Nest tests whether a mixed-trust team of autonomous coding agents can govern itself while producing working software. Four peer agents edit a real repository; one has a private sabotage objective. Tests, audits, discussion, and sanctions have costs. Success means the environment produces reproducible runs whose code, communication, evidence, and governance decisions can be inspected rather than inferred from a chat transcript.

## Positioning

Code Nest combines executable software collaboration with peer-led social deduction. Existing work studies coding sabotage, external monitoring, or social-deduction games separately. Here, the working agents must identify and contain a hidden adversary from the same evidence they use to ship the release.

## Operating Context

An operator selects a pinned repository, scenario, four agent adapters, a random seed, resource limits, and a governance constitution. Code Nest creates isolated execution environments, runs the match, streams observable events into a live web interface, freezes a release candidate, applies hidden scoring, and produces a portable replay bundle.

The usual run lasts tens of minutes and produces thousands of low-level events. The interface therefore needs both a live pulse and a trustworthy path back to the exact diff, test, command, message, or vote behind any claim.

## Capabilities and Constraints

- Four-player, three-round matches with three builders and one hidden saboteur.
- Model- and runtime-neutral adapters.
- One disposable Docker container per participant, with separate workspaces and strict resource limits.
- An external control plane owns roles, secrets, hidden tests, integration, and the event ledger.
- A live observer interface shows submitted rationales, messages, tool use, terminal output, diffs, tests, resource spending, and governance actions.
- Raw private chain-of-thought is neither required nor presented as an observable fact. Provider-supplied reasoning summaries are optional and labelled by provenance.
- All sabotage scenarios are synthetic, offline, and designed to avoid deployable malware.
- The first release runs locally on one machine. Remote multi-host execution is out of scope.

## Brand Commitments

The product name is **Code Nest**. “Town Hall,” “Council,” “builder,” “saboteur,” “constitution,” and “match” are product terms. The tone should feel like a serious experiment with game tension underneath it, not a cartoon imitation of *Among Us*.

## Evidence on Hand

The current project contains a written specification and no running implementation, visual system, benchmark results, customers, or public claims. Future work must not invent those things. Demonstration data in interface prototypes must be labelled synthetic.

## Product Principles

- Real work creates the evidence.
- Trust stays inside the game.
- Security consumes resources.
- Observability must preserve information boundaries.
- A replay should explain what happened without another model call.

## Accessibility & Inclusion

The web interface must meet WCAG 2.2 AA for the core live and replay flows. Status cannot depend on colour alone. Keyboard operation, visible focus, reduced motion, scalable text, and screen-reader access to phase changes and governance outcomes are release requirements.

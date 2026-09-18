# Runtime Isolation

> Read this when working on Docker, participant workers, runtime adapters,
> provider access, credentials, trusted tests, mounts, networking, or cleanup.

## Threat boundary

Participant code and model-produced commands are untrusted. Docker limits
accidental and prompt-driven damage on a single developer machine; it is not a
claim of protection against kernel exploits or hostile multi-tenancy.

The controller and container supervisor may reach Docker. A participant may
never receive the Docker socket, controller filesystem, database, role table,
hidden tests, another workspace, or host credentials.

## Participant defaults

- pinned image digest and non-root UID/GID;
- privileged mode disabled and all Linux capabilities dropped;
- `no-new-privileges`, a default-deny seccomp profile, and read-only root;
- one explicit writable workspace with bounded temporary storage;
- CPU, memory, process, file-size, and wall-time limits;
- no participant-to-participant network path;
- no outbound network except a declared broker route in contained mode;
- fresh lifecycle per participant and verified cleanup after completion.

Exceptions must be scenario-declared, appear in the run manifest, and receive
approval before implementation.

## Adapter modes

Contained mode runs the complete agent CLI inside the participant container.
Split mode keeps the model client and credentials in the control plane while
executing file and shell operations in a networkless worker. Record the mode in
every result; do not pool them silently in comparisons.

Adapters normalize capabilities rather than pretending every runtime is
identical. Unsupported capabilities are explicit. Observable output may include
submitted work notes, commands, stdout/stderr, file changes, tool calls, and
provider reasoning summaries where permitted and clearly labelled.

### Runtime adapter contract v1

`@code-nest/adapters` exposes one asynchronous `RuntimeAdapter` port per
participant session:

```text
metadata -> start -> deliver / run / interrupt -> stop
```

Metadata records adapter, runtime, model, execution mode, observability tier,
and a unique capability set. Negotiation returns requested capabilities in
explicit `available` and `unavailable` lists. Tier 0 cannot declare typed tool
events or work notes; provider reasoning summaries require Tier 2. The contract
has no private-chain-of-thought capability.

Observable output is one discriminated stream. Tier 0/1 records use only the
standard runtime kinds. Tier 2 accepts only provider-reported usage and optional
provider-supplied reasoning summaries, with those provenance labels required by
both the TypeScript contract and runtime parser. A provider summary is evidence
about what the provider chose to report; it is never treated as verified private
reasoning or controller truth.

Start binds a run, scenario, participant, and workspace to one session. Turn
results contain only bounded messages, raw command candidates, exact commit
revisions, an optional tool summary, optional measured usage, and a declared
status. Result objects and metadata are runtime-validated with strict keys.
Commands intentionally remain `unknown` here: the controller must parse each
one through `@code-nest/protocol` and apply participant capability authorization
before accepting it.

The deterministic fake adapter is a scripted outer implementation of the same
port. It records lifecycle inputs, returns defensive copies, aggregates only
reported usage, enforces start/stop ordering, and rejects scripts that expose
tool, usage, or private-message data not declared by metadata. Interrupt and
resume are separate capabilities; a successful interrupt does not imply the
session can continue.

### Direct reference model-loop adapter

The reference loop is a feature-oriented hexagon inside `packages/adapters`.
Its domain owns provider-neutral request and response contracts plus strict
configuration; its application owns lifecycle, inbox delivery, turn deadlines,
token budgets, interruption, usage aggregation, and observation production. A
small provider port is the only model dependency, so concrete SDKs remain outer
adapters rather than controller or game-rule dependencies.

Provider responses are exact-key validated and defensively cloned before state
changes. Commands stay untrusted. Usage becomes Tier 2 `provider_usage` with
`provider_reported` provenance. A configured optional summary becomes Tier 2
`provider_reasoning_summary` with `provider_supplied` provenance. Undeclared
summaries, private-chain-of-thought fields, non-cloneable output, budget overruns,
provider failures, and deadlines fail closed.

### OMP RPC connector

The OMP connector translates the common runtime lifecycle into OMP's headless
JSON-RPC interface. It waits for OMP's readiness frame, verifies the selected
provider and model through `get_state`, registers one host tool for proposed
Code Nest commands, and then drives one persistent OMP process per participant.
The same connector class is instantiated four times; the participants do not
share an OMP process, session, home, or workspace.

OMP receives controller observations only when the application begins a turn.
Its `code_nest_submit_command` calls are captured as untrusted command values
and still pass through normal protocol parsing and participant authorization.
Tool start/end events become bounded Tier 1 evidence. The final assistant text
is a work note, not a public message or trusted fact. Thinking blocks, tool
arguments, tool results, extension UI frames, and raw stderr text are discarded.

The launch uses an explicit environment and passes no credential in arguments.
Session persistence, discovered extensions, discovered skills, title changes,
PTY execution, and OMP subagents are disabled. OMP's autonomous write approval
is acceptable only inside the contained participant boundary described below;
do not use this configuration as a host-side coding agent. For OpenAI, the key
visible to OMP must be the participant's short-lived broker grant and
`OPENAI_BASE_URL` must point at its private broker route, never directly at a
long-lived provider credential.

RPC lines, delivered observations, submitted commands, recorded evidence,
startup, command responses, turns, output tokens, and shutdown are bounded.
Malformed frames, model fallback, counter rollback, timeout, over-budget output,
unexpected exit, and incomplete cleanup fail closed. Interrupt uses OMP's RPC
abort command and keeps the process available for a later declared resume.

### Subprocess adapter v1

The subprocess adapter launches a direct executable and argument vector without
a shell. Its working directory is the participant workspace and its environment
is explicit; host variables are not inherited. One persistent child exchanges
strict NDJSON frames. Protocol stdout is separate from wrapped stdout
observations, raw stderr is Tier 0 evidence, and typed Tier 1 observations require
declared capabilities. Version 1 does not accept Tier 2 reasoning summaries or
session resume.

Only one operation may be pending. Lines, observations, and deadlines are
bounded, and malformed frames, unexpected exit, timeout, or undeclared output
terminate the process. Interruption sends `SIGINT`; stop sends `SIGTERM`; either
escalates to `SIGKILL` after the configured grace period. Final reports are
derived by the adapter from validated results and observed process state, never
accepted as an opaque child-authored summary.

### Split-runtime container v1

The split supervisor accepts only repository images pinned by full SHA-256
digest and explicit non-root UID/GID values. Docker receives direct argument
vectors with no host shell, `--pull never`, network none, private IPC and cgroup
namespaces, a read-only root, all capabilities dropped, no-new-privileges,
built-in seccomp, no devices, no restart, and fixed CPU, memory/swap, process,
file-size, output, and wall-time limits. The Docker CLI subprocess receives only
the small environment allow-list required to locate the trusted engine; model and
cloud credentials are never forwarded into the container.

The only host mount is that participant's workspace seed at
`/opt/code-nest/seed`, read-only. Startup copies it as the participant identity
into bounded tmpfs at `/workspace`; `/home/agent` and `/tmp` are independent
bounded tmpfs mounts. No writable bind or named volume is created. Docker's
actual inspection record must match every required identity, namespace, mount,
label, restart, security, and cgroup field before the worker becomes ready.
Freeze and thaw are explicit. A transport timeout, output overflow, or policy
mismatch removes the container immediately; normal stop is graceful and then
force-verifies removal. The audit-safe manifest omits host paths and environment
values.

`docker/images.json` pins the minimal public test worker. Setup resolves the
active engine endpoint, then pulls that digest through an ephemeral credential-
free Docker client configuration so public fixture installation neither reads
nor writes registry account credentials.

### Contained-runtime credential broker v1

A contained participant uses the same image, identity, filesystem, namespace,
capability, seccomp, restart, device, resource, and observed-policy controls as a
split worker. Its only network is a participant-specific internal bridge with an
isolated gateway. The participant has no published ports and no direct route to
the provider, internet, host, or another participant.

One trusted broker container joins that private bridge and a separate egress
bridge. It is also exact-digest, non-root, read-only, capability-free,
no-new-privileges, built-in-seccomp, device-free, non-restarting, resource-bounded,
and unexposed. The broker receives provider configuration through a temporary
owner-only Docker environment file; the participant receives only a short-lived
grant bound to run, participant, provider, and expiry through the same mechanism.
Those files are deleted immediately after container creation and secrets never
enter Docker command arguments or the audit manifest.

The broker accepts only bounded GET/POST requests for the configured provider and
approved path prefixes. It verifies upstream HTTPS using the system or configured
certificate authority, attaches the long-lived credential itself, rejects
redirects and unsafe headers, and bounds request bytes, response bytes, and wall
time. Audit records contain identifiers, method, path, outcome, status, and byte
counts only—not grants, credentials, or prompt/response bodies. Startup inspects
both containers and exact network membership before readiness. Failure rolls back
in reverse order; normal stop removes the participant, broker, and both networks.

## Trusted tests

Each trusted job archives one clean declared Git revision, verifies that archive
against the frozen candidate SHA-256, and verifies the private single-file
evaluator against its declared SHA-256. Private copies are mounted read-only into
a fresh exact-image container; the candidate extracts into bounded tmpfs. The
container is non-root, network none, read-only-root, private IPC/cgroup namespaced,
capability-free, no-new-privileges, built-in-seccomp, device-free, unexposed,
non-restarting, and bounded by CPU, memory/swap, processes, file size, output, and
wall time. Docker inspection must prove the whole policy before evaluation.

The evaluator emits one strict bounded JSON result tied to the candidate digest.
The controller derives outcome and counts. Public reports may include only checks
the evaluator explicitly marks public; aggregate reports have no check collection
at all. Both projections record candidate revision/digest, evaluator image/digest,
and are HMAC-signed only after projection with a controller-held key. Raw stdout,
stderr, hidden identifiers, summaries, paths, source, traces, timings, host paths,
container IDs, and the signing key never enter the returned report. The container
and private staging directory are removed before success or failure returns.

## Recovery outcomes

Runtime boundaries report bounded structured failure signals to the recovery
domain. An unexpected non-OOM exit, an inspected OOM kill, a model deadline, an
observed policy mismatch, and incomplete removal are different outcomes. The
public ledger fact contains only the fixed safe classification; raw stderr,
container identifiers, engine errors, provider bodies, and host paths remain out
of the event. A retry is never implicit: the outcome says when a declared retry
is required, and the later retry uses its own audited command identity.

After controller reconstruction, the coordinator reads the last committed
sequence and records one idempotent restart outcome. Participant capability
grants still fail closed and must be reissued; recovery does not revive an old
credential or silently resume an adapter that lacks resume support.

## Verification expectations

Isolation tests must attempt forbidden reads, mounts, network destinations,
participant traffic, token reuse, resource exhaustion, and post-run persistence.
Normal completion and cancellation must leave no participant process, network,
or writable run volume behind.

The cross-boundary adversarial suite starts real split and contained participants
and attempts host workspace, peer workspace, hidden evaluator, controller store,
Docker socket, root filesystem, peer-broker, and direct-internet access. It also
inspects process environments for a seeded host credential, exceeds file and
captured-output allowances, exercises both normal and operator-cancelled shutdown,
and audits labelled containers, networks, and volumes afterward. A separate raw
SQLite inspection proves a seeded public-output secret was replaced before any
database bytes were written.

The heterogeneous match acceptance test keeps four distinct participant
containers alive per round, with two split and two contained boundaries. It runs
the same three-round Station Access candidate through reference and deterministic
adapter contracts, checks that adapter mode matches the inspected manifest,
records every common runtime descriptor, and verifies no labelled container,
network, or volume remains after normal completion.

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

## Trusted tests

Trusted tests use a fresh networkless container and an exact candidate digest.
Participants receive only the scenario-authorized result. Hidden test names,
paths, source, stack traces, timings, and detailed failures never enter a
participant-visible payload.

## Verification expectations

Isolation tests must attempt forbidden reads, mounts, network destinations,
participant traffic, token reuse, resource exhaustion, and post-run persistence.
Normal completion and cancellation must leave no participant process, network,
or writable run volume behind.

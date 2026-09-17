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

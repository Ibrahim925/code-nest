# Protocol and Events

> Read this when adding or changing participant commands, controller events,
> capability tokens, artifact references, SSE delivery, or replay serialization.

## Contracts

Protocol types are external compatibility contracts. Use explicit schema
versions and runtime validation at every process boundary. A TypeScript type
alone does not validate network or subprocess input.

Commands express requested intent. Events express accepted facts. Do not emit an
event named as though an action occurred when the controller merely received a
request.

Every command includes:

- protocol version;
- command ID used for idempotency;
- run and participant identity where applicable;
- capability context;
- command-specific payload.

Every event includes:

- schema version, run ID, and monotonically increasing run sequence;
- stable event ID and controller timestamp;
- event kind and typed payload;
- visibility class;
- causation and correlation identifiers;
- artifact digests rather than unbounded inline output.

## Visibility

Visibility is enforced while reading, not left to the browser. Define explicit
classes for public, participant-private, operator-private, covert, and
post-reveal information. The saved public replay must not contain redacted secret
fields; omit them rather than relying on UI hiding.

Adding a field to an existing event is unsafe until its visibility and replay
semantics are reviewed. Role assignments, private beliefs, covert objectives,
hidden-test details, credentials, and provider-private traces require the
narrowest class.

## Delivery and replay

The controller commits events before publishing SSE. Clients reconnect from the
last observed sequence and deduplicate by sequence because delivery is at least
once. Missing sequence ranges are fetched before live projection resumes.

Projectors must be deterministic:

    same replay bundle + same projector version = same visible state

Do not use wall-clock reads, random values, network calls, or model calls while
replaying. If migration is required, preserve the original bytes and record the
migrator version.

## Evolution checklist

- Add a new version when semantics change; do not reinterpret historical data.
- Include a fixture for valid, invalid, duplicate, late, and unauthorized input.
- Test each observer mode and the post-reveal transition.
- Test reconnect from an arbitrary sequence with duplicate delivery.
- Document compatibility and migration before merging a breaking change.

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

## Version 1 envelopes

`@code-nest/protocol` exports the command and event schemas as JSON Schema
2020-12 objects, their inferred TypeScript types, and non-throwing parse
functions. Other runtimes may serialize the schemas and validate the same wire
messages without importing TypeScript types.

The command envelope has this fixed control shape:

```text
protocolVersion = "1.0"
commandId
runId = identifier | null
actor = { kind, id }
capability = { tokenId: identifier | null }
kind
payload = JSON value
```

`runId` is null only for commands that precede run creation. `tokenId` identifies
controller-issued authority but is not the credential itself. Bearer material
belongs to the transport so it cannot leak through a persisted command body.

The event envelope has this fixed control shape:

```text
schemaVersion = "1.0"
eventId, runId, sequence, recordedAt
actor = { kind, id }
context = { round: integer | null, phase: kind | null }
kind, payload, visibility
causationId, correlationId, parentEventIds[]
artifactDigests[], resourceCost{}
```

Sequences start at one. Timestamps are RFC 3339 `date-time` strings assigned by
the controller. Payloads must be JSON values: functions, `undefined`, non-finite
numbers, and other process-local values are invalid at the boundary.

Both envelopes reject undeclared control fields. Payload validation for a
specific `kind` belongs to the command or event registry layered on top of this
base envelope. A new kind does not change the base version, but a new control
field, renamed field, changed meaning, or relaxed visibility rule does.

Malformed envelopes return `INVALID_COMMAND_ENVELOPE` or
`INVALID_EVENT_ENVELOPE` with stable JSON-pointer issues. A string version other
than `1.0` returns the corresponding `UNSUPPORTED_*_VERSION` error and lists the
supported versions. Parsers do not coerce or mutate accepted input.

## Visibility

Visibility is enforced while reading, not left to the browser. Define explicit
classes for public, participant-private, operator-private, covert, and
post-reveal information. The saved public replay must not contain redacted secret
fields; omit them rather than relying on UI hiding.

Version 1 represents visibility as a tagged object. `public`,
`operator_private`, and `post_reveal` carry no recipient list.
`participant_private` and `covert` require one to 64 unique participant IDs.

Adding a field to an existing event is unsafe until its visibility and replay
semantics are reviewed. Role assignments, private beliefs, covert objectives,
hidden-test details, credentials, and provider-private traces require the
narrowest class.

### Version 1 projection rules

The controller builds projection context from the authenticated token and the
durable run state. It must not accept an audience or reveal state from a request
body. A requested run ID must also match the event's run ID.

| Visibility class | Named participant | Clean observer | Unblinded observer | Operator | Revealed replay |
|---|---|---|---|---|---|
| `public` | yes | yes | yes | yes | yes |
| `participant_private` | recipients only | no | yes | yes | yes |
| `covert` | recipients only | no | yes | yes | yes |
| `post_reveal` | no | no | yes | yes | yes |
| `operator_private` | no | no | no | yes | no |

Projection returns the complete event or omits it. It never leaves a redacted
placeholder in the stream. If one domain action contains facts with different
audiences, the producer must emit separate events before persistence.

`sealed` projection is also used after a match when replaying what the team or a
selected participant knew at the time. `revealed` projection is allowed only
after scoring and role reveal. Operator-private events stay out of observer
replays permanently.

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

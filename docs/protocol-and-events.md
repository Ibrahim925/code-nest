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

## Run setup v1

`@code-nest/protocol` publishes a strict `RunSetupConfigurationSchema` and parser
for the operator creation boundary. The record binds one stable run ID to a
scenario ID, manifest SHA-256, full Git revision, participant and evaluator OCI
digests, exactly four distinct participant/adapter selections, deterministic
seed, bounded resource limits, disclosure policy, and constitution. Unknown
fields and malformed or unpinned identifiers fail closed.

The configured `POST /runs` body carries the same run ID outside and inside this
record. The controller rejects mismatches before persistence. A successful
creation stores the complete record inside the public `run.created` payload so a
replay can identify its inputs without a mutable setup table. It is public only
because Version 1 contains reproducibility metadata rather than roles, covert
briefs, hidden tests, provider credentials, or bearer material. The operator
token remains exclusively in the transport authorization header.

Legacy creation with only `{ "runId": ... }` remains accepted. New operator
clients always send the configuration. An exact command retry replays its first
result; the same idempotency key with changed configuration is a conflict.

Malformed envelopes return `INVALID_COMMAND_ENVELOPE` or
`INVALID_EVENT_ENVELOPE` with stable JSON-pointer issues. A string version other
than `1.0` returns the corresponding `UNSUPPORTED_*_VERSION` error and lists the
supported versions. Parsers do not coerce or mutate accepted input.

## Participant capabilities

The controller issues each participant an opaque bearer token plus a non-secret
token ID. The bearer exists only at the transport boundary; the matching parsed
command carries the token ID in `capability.tokenId`. Authorization requires all
of these facts to agree:

- the bearer digest matches the selected active grant;
- the command actor is a participant with the grant's participant ID;
- the command run matches the grant's run;
- the command kind appears in the grant's action set;
- controller time is strictly before the expiry; and
- the command ID has not already been authorized in that run, including under a
  rotated token.

Revocation takes effect in memory before its audit write, so an audit failure
cannot leave the credential active. Controller restart discards all grants and
therefore fails closed; the runtime supervisor must issue new short-lived tokens
when it restores participant sessions. Operator and observer bearer values are
reserved during participant-token generation so one credential cannot cross an
API role boundary.

The ledger records operator-private `capability.issued`,
`capability.rejected`, and `capability.revoked` events only for existing runs.
Those events contain token IDs, scopes, claimed request metadata, and rejection
reasons, but never a bearer token or bearer digest. Public and participant replay
therefore cannot recover credential material. A participant-facing transport
must map all denial reasons to the same safe `CAPABILITY_DENIED` message;
detailed reasons remain trusted audit facts.

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

An accepted private belief is a `belief.reported` event. Its actor and sole
`participant_private` recipient are the reporting participant; its round and
phase are explicit; its strict payload contains the versioned 100-point report;
and its single parent is the strongest evidence event the participant was allowed
to see in that round. Public votes never reuse or overwrite this event.

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

Observer unblinding is the public `observer_unblinded` event. Its strict payload
states `mode: unblinded`, `benchmarkEligible: false`, and the fixed
`operator_unblinding` intervention class; it contains no credential or private
evidence. The operator-only HTTP command is bodyless and idempotent. Browser read
routes derive their projection from this durable event rather than accepting an
audience or reveal state from the request. A later `match.roles_revealed` event
changes the research perspective to post-match reveal but never restores
benchmark eligibility or reveals `operator_private` events.

### Match completion facts

Normal three-round completion records public `match.phase_advanced`,
`match.round_work_completed`, `match.round_integrated`,
`match.candidate_frozen`, and `match.completed` facts. Public candidate facts
contain the committed revision and SHA-256 identity but never a host path.

`scoring.legitimate_completed`, `scoring.covert_completed`,
`match.roles_revealed`, and `match.scoreboard_published` are separate
`post_reveal` facts. The scoreboard includes every Section 14 component; the
covert result includes the scenario-authorized objective description. A sealed
clean projection omits those events completely. Completion events use existing
Version 1 envelopes, so these new kinds do not change the base wire version.

## Delivery and replay

The controller commits events before publishing SSE. The ledger's sequence is a
trusted ordering field and is never sent to a filtered audience: a gap would
reveal that an omitted event exists. SSE data therefore uses a separate strict
Version 1 delivery record:

```text
deliveryVersion = "1.0"
deliverySequence = audience-visible integer starting at one
event = event envelope without its ledger sequence
```

`deliverySequence` is contiguous within one run and projection context. It
counts only events that audience may receive. It is suitable for ordering a
rendered projection, but it is not a durable ledger cursor and must never be
translated back into a source sequence by a client.

Each SSE frame uses the stable, opaque event ID as its `id`. A reconnect sends
that value through `Last-Event-ID`; the controller verifies that the referenced
event belongs to the requested run and is visible to the authenticated
audience, computes its visible ordinal, catches up from the private source
position, and then resumes live delivery. Unknown, cross-run, and unauthorized
cursors all fail as `INVALID_EVENT_CURSOR`. Clients deduplicate by event ID
because delivery is at least once.

The browser validates the SSE event type, JSON body, complete Version 1 delivery,
and agreement between the frame ID and delivered event ID before projection. It
expects the next audience-visible delivery sequence, but never treats that number
as a ledger cursor. A higher number triggers recovery from the last accepted
event ID. An exact repeated event is ignored; a reused event ID, changed prior
sequence, malformed delivery, or unsupported version is a terminal protocol
failure. Transport recovery is bounded and exposes an honest failed state when
the stream cannot be restored.

The authenticated token determines whether the stream is a clean-observer or
operator projection. Audience, run identity, reveal state, source sequences,
and hidden placeholders are never accepted from or returned to a clean client.
Missing source events are fetched before live projection resumes.

Projectors must be deterministic:

    same replay bundle + same projector version = same visible state

Do not use wall-clock reads, random values, network calls, or model calls while
replaying. If migration is required, preserve the original bytes and record the
migrator version.

## Evolution checklist

- Add a new version when semantics change; do not reinterpret historical data.
- Include a fixture for valid, invalid, duplicate, late, and unauthorized input.
- Test each observer mode and the post-reveal transition.
- Test reconnect from an arbitrary visible event ID with duplicate delivery.
- Document compatibility and migration before merging a breaking change.

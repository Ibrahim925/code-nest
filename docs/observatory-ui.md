# Live Observatory UI

> Read this when changing the live run view, evidence inspector, Town Hall,
> Constitution Lab, replay, observer modes, motion, or accessibility.

## Product job

The interface must make a consequential multi-agent run understandable without
pretending to expose private thought. It should answer: what is happening, what
changed, what evidence was available, what the team decided, and what that
decision cost.

## Primary surfaces

- Run setup: repository/scenario, adapters, seed, constitution, and limits.
- Live Observatory: four concurrent agent lanes, phase, budget, container health,
  observable actions, terminal output, changes, tests, and work notes.
- Town Hall: messages, evidence citations, motions, ballots, and sanctions.
- Evidence inspector: exact commit, diff, command output, test report, candidate,
  and visibility at the cited moment.
- Replay: deterministic timeline with post-match reveal and private beliefs.
- Constitution Lab: repeated-condition comparisons with uncertainty intervals.

## Observer modes

Clean spectator mode exposes only information available under the constitution.
Unblinded researcher mode is an audited intervention that changes benchmark
eligibility. Post-match reveal unlocks covert roles, objectives, and eligible
private beliefs only after the match ends.

The active mode is always visible directly below the run bar. Clean spectator
says both `Benchmark eligible` and that only public evidence is projected.
Unblinding requires a two-step control whose confirmation names the permanent
public audit event, newly visible private research evidence, and exclusion from
unattended benchmark aggregates. After success, a persistent `Unblinded
researcher · Benchmark ineligible` banner replaces the control. Post-match reveal
has a separate label and preserves any earlier ineligibility.

## Portable replay

A completed or cancelled run exposes one `Save replay bundle` action next to its
observer state. Before termination the same area says why export is unavailable.
The start surface can open a local Version 1 bundle without asking for an
operator token. Import failures name an inconsistent bundle and never attempt a
network recovery.

The replay header permanently names `Offline deterministic replay`, perspective,
benchmark eligibility, projector version, terminal state, and embedded-evidence
count. One range control plus previous/next buttons selects an audience-visible
event prefix. Lanes, chronology, Town Hall, Workstream, evidence, beliefs, reveal,
and metrics all derive from that same prefix. Belief reports remain submissions,
not ground truth; calibration appears only after an authorized role reveal.

Embedded artifacts use the same inert evidence inspector as live viewing and are
SHA-256 verified in the browser. No replay interaction may call the controller,
Docker, a model, a provider, or the network. Wide layouts keep timeline and
analysis records side by side where useful; phones preserve document order and
provide full-width controls without horizontal scrolling.

Never label text as an agent's internal thought. Use “work note,” “submitted
rationale,” or a provider-specific reasoning-summary label with provenance.

## Interaction and performance

The live screen uses progressive disclosure: a stable four-lane pulse first,
details on selection. Reconnection fills missing sequences before returning to
live mode. Virtualize large timelines and logs; artifacts load on demand.

The Workstream and replay chronology retain every authorized event in their
ordered projections while rendering an 80-row window. Older and newer controls
name the exact visible range and work from the keyboard. The live adapter batches
arrivals once per animation frame, then applies each projector in delivery order.
Four simultaneous terminal streams therefore do not cause one React render per
stream chunk. A compact connection metric reports the share observed within the
two-second local target and retains only aggregate counts.

## Constitution Lab

Completed comparison records open locally from the setup surface. The first
research ledger shows all three constitutions side by side with means, 95%
intervals, observed counts, and missing counts. A labelled SVG plots release
quality against successful sabotage, with governance spending encoded by point
size; its exact values remain available in the adjacent semantic table.

The method record names the fixed scenario, revision, roster, model and adapter
disclosures, execution modes, observability tiers, image and test digests, limits,
and retry policy. Split and contained modes are never collapsed into one runtime
estimate. After aggregate evidence, a researcher can select one repetition and
compare same-seed trials by round and phase across evidence counts, spending, and
decision counts. Run IDs and every retry attempt remain inspectable.

## Four-lane pulse

The first live projection fixes lane order from the validated run setup, never
from event arrival. Every lane uses the same scan order: participant and phase,
factual activity, assignment, runtime/model disclosure, container health,
observability, latest reported commit, and the event that caused the activity.

Initial values say `Awaiting briefing`, `Capabilities pending`, `None reported`,
or `Not reported`. In particular, a runtime-start event does not prove that a
container is healthy. A health label appears only after an authorized
container-health event. Wide screens show four equal lanes, medium screens show
two by two, and phones use one column without changing chronological meaning.

## Observable Workstream

The Workstream defaults to merged chronology and can switch to four participant
lanes or filter one actor. Every card names its actor, round/phase, causal event,
verification class, and provenance. Work notes and provider summaries say
`self-report`; local tests say `untrusted self-report`; runtime commands and
output say `observed`; captured commits say `attributed`; control-plane artifact
references say `trusted`.

Terminal and command bodies use a bounded plain-text code surface. Other text
keeps whitespace but receives no Markdown or HTML interpretation. ANSI controls
and terminal hyperlinks are removed before projection. Unsafe filenames do not
produce cards. SVG and all other artifact content remain collapsed behind a
digest-only `load on demand` record until the evidence inspector authorizes and
sanitizes retrieval. Phones retain the merged chronology by default and stack
per-agent lanes if that alternate view is chosen.

## Evidence inspector

Selecting `Inspect exact evidence` pins one Workstream record beside the timeline.
The inspector repeats the exact event ID, actor, visibility, verification class,
causation, correlation, parent events, body, and artifact digests so an observer
does not lose the citation's original context. Wide screens use a sticky secondary
record; narrower screens stack it after the Workstream without changing meaning.

Artifacts load only after an explicit action. A verified allow-list of UTF-8 text
may appear as escaped plain text. SVG is named but never rendered inline, and all
other media receives an explicit binary-preview message. Digest mismatch,
oversize, malformed metadata, missing authority, and absence are visible as safe
failures rather than invented previews.

## Town Hall

When authorized Town Hall events arrive, the primary Observatory column places
the public governance record before the Workstream while the evidence inspector
remains beside it. The surface fixes speaking order, names the current speaker,
and keeps evidence/accusation separate from defence/rebuttal/action. A yield is an
explicit turn, never an empty or fabricated statement.

Each citation shows its claimed kind and `valid`, `mismatched`, or `missing`
classification in text. Valid and mismatched references may open matching
authorized evidence; missing or unavailable references stay disabled. The UI
does not assess whether an argument is persuasive.

Open ballots show the motion, proposer, electorate size, approval rule, deadline,
and submitted count under an explicit sealed label. Choices appear only after
closure, including whether an abstention was automatic. Passed authority is
visually and verbally separate from later controller-confirmed effects and credit
spend. On phones, speaking order becomes two rows and discussion, ballots,
effects, and evidence stack in document order.

## Accessibility

Core live and replay flows target WCAG 2.2 AA. Status never depends on color.
Support keyboard operation, visible focus, scalable text, reduced motion, and
screen-reader announcements for phase changes and governance outcomes. Preserve
chronological meaning when layouts collapse on smaller screens.

Phase and closed-governance changes use dedicated polite atomic announcements.
Terminal bodies remain ordinary bounded plain text, outside live regions, so a
busy participant cannot continuously seize the accessibility tree. Window
navigation also announces its range politely after an explicit user action.

Synthetic interface data must be labelled synthetic. Do not invent benchmark
results, customers, publication claims, or model performance.

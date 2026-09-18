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

Never label text as an agent's internal thought. Use “work note,” “submitted
rationale,” or a provider-specific reasoning-summary label with provenance.

## Interaction and performance

The live screen uses progressive disclosure: a stable four-lane pulse first,
details on selection. Reconnection fills missing sequences before returning to
live mode. Virtualize large timelines and logs; artifacts load on demand.

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

## Accessibility

Core live and replay flows target WCAG 2.2 AA. Status never depends on color.
Support keyboard operation, visible focus, scalable text, reduced motion, and
screen-reader announcements for phase changes and governance outcomes. Preserve
chronological meaning when layouts collapse on smaller screens.

Synthetic interface data must be labelled synthetic. Do not invent benchmark
results, customers, publication claims, or model performance.

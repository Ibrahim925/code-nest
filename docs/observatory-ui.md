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

## Accessibility

Core live and replay flows target WCAG 2.2 AA. Status never depends on color.
Support keyboard operation, visible focus, scalable text, reduced motion, and
screen-reader announcements for phase changes and governance outcomes. Preserve
chronological meaning when layouts collapse on smaller screens.

Synthetic interface data must be labelled synthetic. Do not invent benchmark
results, customers, publication claims, or model performance.

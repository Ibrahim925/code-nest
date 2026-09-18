# Matched Constitution Experiments

> Read this when planning repeated matches, changing trial provenance, adding a
> comparison metric, or preparing data for Constitution Lab.

## Comparison unit

A constitution experiment is a set of matched stochastic trials. Each repetition
uses one explicit seed under Open Merge, Council, and Elected Maintainer. The
scenario and base revision, four-player roster, adapter and model disclosures,
execution modes, observability tiers, image digests, test digests, time and token
limits, and retry policy stay fixed. Only the constitution changes within a
matched repetition.

At least five distinct non-negative seeds are required. A replay reconstructs one
completed match; repeating a seed starts a new stochastic trial and is not called
a replay or deterministic counterfactual.

## Runner boundary

`apps/controller/src/experiments` is a feature-oriented hexagon:

- the domain validates immutable experiment plans and calculates statistics;
- the application runner coordinates logical trials and named attempts;
- `ExperimentMatchRunner` is the port through which a concrete match composition
  applies the requested constitution; and
- `ExperimentRecorder` receives the plan, each attempt outcome, and the final
  comparison result for durable recording by the composition root.

The experiment domain knows nothing about Docker, SQLite, HTTP, models, or the
Observatory. Match adapters return bounded observations in four shared families:
delivery, security, belief, and governance. Provider-specific reasoning summaries
are not experiment metrics.

Each successful observation also carries a bounded phase trace: round, phase,
evidence-event count, governance credits spent, and decision count. It contains
comparison facts rather than message bodies or private reasoning. Constitution
Lab aligns those points for same-seed trials after showing aggregate results.

## Failure and uncertainty

A retry creates a fresh attempt ID under the same logical trial. The failed
attempt remains in the result with a declared terminal reason. Only reasons named
by the experiment's bounded retry policy may run again; there is no silent retry.

Exhausted trials contribute missing observations, never zeros or copied values.
Every metric reports observed and missing counts. Binary rates use a 95% Wilson
interval. Continuous values use a two-sided 95% Student interval, with unit-scale
metrics clamped to their valid range. The interface must show the repetition
count and interval together with the mean.

## Constitution Lab projection

The browser loads one completed Version 1 comparison record locally and validates
the three conditions, five-or-more repetitions, trial matrix, metric counts, and
phase traces before rendering. Outcome distributions and their intervals appear
before any selected run. The primary chart plots release quality against
successful sabotage and uses point size for governance spending; a table remains
the exact accessible source for every value.

Runtime mode, observability tier, model and adapter disclosure, image and test
digests, limits, and retry policy remain visible. A mixed roster is described as
fixed provenance, never pooled into a runtime estimate. The matched-run ledger
then aligns Open Merge, Council, and Elected Maintainer by round and phase and
retains failed attempts and missing observations.

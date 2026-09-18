# Station Access demonstration set

These four files are synthetic, deterministic examples—not measured model
performance. Open any `*.replay.json` file from the Code Nest setup screen to
inspect it offline. No controller, model, provider, Docker runtime, or network
call is needed.

- `successful-defence.replay.json` — a targeted investigation catches the
  harmful condition before release.
- `successful-covert-release.replay.json` — broad legitimate quality passes,
  but the generated covert condition reaches the release.
- `infrastructure-failure.replay.json` — an adapter crash ends in a preserved
  partial replay rather than a game outcome.
- `false-accusation.replay.json` — a builder is wrongly quarantined, six credits
  are spent, and a 0.25 contribution loss remains visible after reveal.

Every replay is tied to the pinned Station Access manifest and repository
revision in `replays/manifest.json`. Regenerate the exact set with:

```sh
corepack pnpm --filter @code-nest/controller exec tsx ../../scripts/generate-demonstrations.ts
```

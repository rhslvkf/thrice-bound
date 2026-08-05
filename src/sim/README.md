# src/sim

Headless balance simulator.

## Responsibility

Runs battles and whole runs without a renderer, thousands of times, to answer
balance questions: win rate per starting build, unit and synergy pick rates,
average run length, difficulty spikes by stage, and which relics are dead
weight. Output is numbers a human reads before tuning `src/data`.

## Why it can exist

Because `src/core` is pure and takes an injected seeded RNG, the exact code that
runs in the browser also runs here under Node — no mocks, no parallel
implementation. Results are reproducible: a seed that produces a surprising
outcome can be replayed in the game.

## Rules

- **Imports `src/core` and `src/data` only.** Importing `src/render`, `src/ui`,
  `src/audio` or `src/meta` is a bug — it means core has grown a browser
  dependency.
- Not part of the game build. `npm run sim` runs it via `tsx`; it never ships in
  `dist/`.
- Always seed explicitly and report the seeds used, so any run can be
  reproduced.
- Sweep across many seeds before drawing a conclusion; single-run results are
  noise.

## Status

Stub. `main.ts` currently just proves the RNG is reachable from Node. It fills
in once battle resolution exists in core.

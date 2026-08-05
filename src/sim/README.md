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

## Usage

| Command                 | What it does                                   |
| ----------------------- | ---------------------------------------------- |
| `npm run sim`           | One battle on the default seed, in detail      |
| `npm run sim -- 42`     | One battle on seed 42                          |
| `npm run sim -- 42 200` | 200 battles from seed 42, as a win-rate sweep  |

## Status

Battles run. Team generation is still random rather than modelling real
shop-and-merge decisions, and the sweep reports win rates but not per-unit or
per-synergy pick rates. Those come next.

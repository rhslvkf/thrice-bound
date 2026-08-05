# src/core

Battle logic and run state. Pure TypeScript.

## Responsibility

Everything that decides *what happens*: merge resolution, combat ticks, damage
and status effects, synergy activation, deck and shop state, run progression
rules. Given the same inputs, this folder produces the same outputs — always.

## Hard rules

- **Never import PixiJS.** Never touch the DOM, `window`, `document`,
  `localStorage`, `fetch`, or any other browser API. This code runs under plain
  Node in the headless simulator; anything browser-shaped breaks it.
- **Never call `Math.random()`.** Take an `Rng` (`./rng.ts`) as a parameter.
  Battle replay and balance simulation depend entirely on this.
- **Never read a clock.** Callers pass in a delta; core does not know whether
  it is running at 60 fps or as fast as the CPU allows.
- **Never import from `src/render`, `src/ui`, or `src/audio`.** Dependencies
  point inward. Core does not know a renderer exists.
- Keep state serializable — plain objects, arrays, numbers, strings. Save/load
  and replay both round-trip through JSON.
- No magic numbers. Tuning values come from `src/data`.

## Testing

Every new piece of logic here ships with unit tests in the same commit, as
`*.test.ts` next to the source. Determinism assertions are the priority: pin a
seed and check the exact outcome.

## Contents

- `rng.ts` — seeded deterministic RNG (mulberry32). The foundation for replay
  and simulation; treat its output sequence as a stable contract.

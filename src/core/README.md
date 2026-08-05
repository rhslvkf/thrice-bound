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
- `config.ts` — simulation constants: tick length, battle timeout, mitigation
  caps, the synergy counting rule.
- `battle/` — the battle engine. Public entry point is `battle/index.ts`.

## The battle engine

`runBattle(data, setup)` simulates to completion; `createBattle` plus
`stepBattle` drive it a tick at a time. `stepBattle` is a pure function — it
copies the state, works on the copy, and returns a new one, so the same state
stepped twice gives the same result and the input is never touched.

Time is a **fixed 50ms tick**. Nothing reads a clock; the renderer's frame rate
and the simulator's speed are both irrelevant to the outcome. The RNG's state
rides inside `BattleState` as a plain number, which is what keeps the whole
battle serializable and replayable.

### Files

Split so that a balance change means opening one file:

| File            | Owns                                                   |
| --------------- | ------------------------------------------------------ |
| `types.ts`      | State shapes. Plain data, JSON round-trippable.        |
| `events.ts`     | The event log the renderer replays.                    |
| `context.ts`    | Per-tick mutable working set, and state cloning.       |
| `grid.ts`       | Board geometry — Chebyshev distance, occupancy.        |
| `stats.ts`      | Effective stats, modifier stacking, shields, statuses. |
| `targeting.ts`  | Who a unit fights, and who an effect lands on.         |
| `damage.ts`     | Mitigation, shields, death, healing.                   |
| `movement.ts`   | Stepping toward a target.                              |
| `effects.ts`    | Applying the content `Effect` vocabulary.              |
| `abilities.ts`  | Trigger dispatch, cooldowns, proc rolls.               |
| `synergy.ts`    | Counting tags and applying thresholds.                 |
| `spawn.ts`      | Creating units, including summons.                     |
| `setup.ts`      | Building tick 0 from a board layout.                   |
| `tick.ts`       | The step function and the end conditions.              |

### Rules worth knowing

- **Tick order is fixed**: age timers, damage-over-time, periodics, interval
  abilities, then each living unit acts in `instanceId` order, then queued
  reaction triggers drain. Changing this order changes every battle.
- **Ties break on `instanceId`**, never on the RNG. The RNG is reserved for
  ability proc rolls and `randomEnemy` selection.
- **A unit keeps its target until that target dies**, rather than re-picking
  the nearest enemy every tick.
- **Synergies are counted once, at battle start**, by distinct unit definition
  rather than by body — see `SYNERGY.countsDistinctUnitTypes` in `config.ts`.
- **Ending**: one team wiped, both wiped on the same tick (a draw), or the tick
  cap, where the larger surviving HP fraction wins and an exact tie is a draw.

### What is deliberately absent

No pixel coordinates, no interpolation progress, no animation state. A unit is
on a cell or it is not; the `move` event carries the step duration so the
renderer can tween between cells at whatever frame rate it likes.

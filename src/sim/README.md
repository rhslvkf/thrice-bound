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

```
npm run sim -- --matches 10000 --seed 42
npm run sim -- --help
```

| Option              | Meaning                                          |
| ------------------- | ------------------------------------------------ |
| `--matches N`       | Random matches to run                            |
| `--seed N`          | Base seed for the whole run                      |
| `--workers N`       | Worker threads (default: CPU count)              |
| `--team-size N`     | Units per side (default 4)                       |
| `--merge-samples N` | Paired battles per merge option, `0` to skip     |
| `--out DIR`         | Report directory (default `tools/reports`)       |
| `--baseline PATH`   | Snapshot to compare against                      |
| `--no-report`       | Run the analysis, write nothing                  |

Exit code is `1` when any warning fired, so CI can gate on balance without
parsing the output. Informational coverage notes do not fail the run.

## Output

Written to `tools/reports/`:

- `balance-report.md` — the human-readable report, warnings first
- `units.csv`, `synergies.csv`, `merge-paths.csv`, `durations.csv`
- `latest.json` — machine-readable snapshot, and the next run's baseline

## What it measures

- **Per unit**: win rate when present, average survival, damage dealt and
  taken, death rate. Win rate is compared against the **median of the same
  tier** — a tier 3 unit outperforming a tier 1 one is the design working, not
  a bug.
- **Per synergy tier**: win rate of teams running it against teams where that
  synergy is off entirely.
- **Per merge decision**: a controlled paired experiment. Both arms face the
  same enemy, the same supporting cast and the same battle seed, so the only
  difference measured is the merge choice. A gap over 8pp is flagged, with its
  95% sampling margin alongside so a borderline call reads as borderline.
- **Battle length**: exact percentiles and a histogram, with warnings when
  fights are too short to read, too long to sit through, or too often decided
  by the clock.
- **Regressions**: units whose win rate moved 5pp or more since the last
  report.

## Parallelism

Work is split into jobs and pulled by one worker per core. Battle lengths vary
by an order of magnitude, so pulling beats a static split — a fixed division
leaves cores idle behind one unlucky chunk.

The result does not depend on how the work was divided. Every job derives its
own seeds, and the aggregate's accumulators are integers: float addition is not
associative, so float accumulators would make a 4-worker run differ from a
1-worker run in the last bits. Damage is therefore stored in thousandths.

## Performance

~2,000 battles/second on four cores; the 22,000-battle default run finishes in
about 11 seconds.

## Status

Team generation is uniformly random rather than modelling real shop-and-merge
decisions, so the win rates describe "this unit was on the board", not "a
player chose this unit". Modelling economy and draft order is the next step.

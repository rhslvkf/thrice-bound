# Run pacing

500 runs, base seed 1, simulated in 14.9s.

Battle time is **measured** — ticks times the tick size is exactly the playback the renderer produces at 1x. Decision counts are measured too. How long each decision takes a human is **estimated**, from the `PACING` constants in `src/sim/config.ts`.

## Duration

| | All runs | Victories |
| --- | --- | --- |
| mean | 8:28 | 8:37 |
| median | 8:31 | 8:32 |
| p10 | 7:23 | 7:44 |
| p90 | 9:38 | 9:39 |
| min | 4:26 | 7:05 |
| max | 11:11 | 10:42 |
| in 6:00–10:00 band | 94.4% | 96.7% |

Split: 3:07 watching fights, 5:21 deciding.

## Outcomes

- victories: 242 (48.4%)
- defeats: 258
- mean rounds reached: 11.9

## Per round

| Round | Reached | Win rate | Mean fight | Mean lives lost |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 500 | 100.0% | 2.2s | 0.0 |
| 2 | 500 | 100.0% | 4.2s | 0.0 |
| 3 | 500 | 100.0% | 6.7s | 0.0 |
| 4 | 500 | 100.0% | 7.8s | 0.0 |
| 5 | 500 | 99.8% | 11.2s | 0.0 |
| 6 | 500 | 85.0% | 20.9s | 0.5 |
| 7 | 500 | 90.2% | 17.2s | 0.3 |
| 8 | 500 | 78.4% | 34.7s | 0.7 |
| 9 | 499 | 90.8% | 10.5s | 0.3 |
| 10 | 496 | 80.8% | 30.8s | 0.7 |
| 11 | 486 | 83.1% | 16.2s | 0.9 |
| 12 | 475 | 50.9% | 26.9s | 3.1 |

## Actions per run (mean)

| Action | Count | Seconds each | Total |
| --- | ---: | ---: | ---: |
| shops opened | 11.9 | 10.0s | 119s |
| purchases | 30.0 | 1.5s | 45s |
| rerolls | 1.2 | 2.5s | 3s |
| sells | 4.4 | 1.5s | 7s |
| merges | 7.8 | 4.0s | 31s |
| reward choices | 10.1 | 8.0s | 80s |
| battles | 11.9 | 3.0s | 36s |


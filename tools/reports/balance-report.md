# THRICEBOUND balance report

Generated 2026-08-05T08:35:27.300Z — 22,000 battles in 10.7s on 4 worker(s).

| Setting | Value |
| --- | --- |
| Random matches | 10000 |
| Merge samples per option | 300 |
| Team size | 4 |
| Seed | 42 |
| Tick | 50ms |

## Warnings

- **[merge-path]** Alpha Howler: Verdant Colossus 80.3% vs Primal Avatar 64.0% — 16.3pp gap (+/-7.1pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Bramble Stalker: Verdant Colossus 80.0% vs Primal Avatar 60.3% — 19.7pp gap (+/-7.2pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Dire Pup: Moss Warden 56.5% vs Alpha Howler 47.3% — 9.2pp gap (+/-8.0pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Gear Artificer: Titan of the Forge 73.7% vs Primal Avatar 59.2% — 14.5pp gap (+/-7.5pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Iron Bulwark: Titan of the Forge 75.2% vs Sovereign Engine 62.8% — 12.3pp gap (+/-7.3pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Plague Hound: Bone Leviathan 75.3% vs Lich Regent 57.2% — 18.2pp gap (+/-7.4pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Rot Knight: Bone Leviathan 76.3% vs Lich Regent 58.7% — 17.7pp gap (+/-7.4pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Scrap Sentry: Iron Bulwark 53.5% vs Gear Artificer 44.7% — 8.8pp gap (+/-8.0pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Thornling: Moss Warden 52.0% vs Bramble Stalker 40.2% — 11.8pp gap (+/-7.9pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Void Caller: Archon of Ash 69.3% vs Void Sovereign 58.7% — 10.7pp gap (+/-7.6pp, n=300/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[unit]** Archon of Ash (T3) wins 76.9% against a tier 3 median of 63.9% — +13.0pp, n=2614.
- **[unit]** Bone Acolyte (T1) wins 45.2% against a tier 1 median of 35.0% — +10.2pp, n=2639.
- **[unit]** Ember Magus (T2) wins 59.8% against a tier 2 median of 46.8% — +12.9pp, n=2747.
- **[unit]** Lich Regent (T3) wins 72.0% against a tier 3 median of 63.9% — +8.1pp, n=2741.
- **[unit]** Rune Scribe (T1) wins 45.2% against a tier 1 median of 35.0% — +10.3pp, n=2766.
- **[unit]** Spark Imp (T1) wins 45.6% against a tier 1 median of 35.0% — +10.6pp, n=2750.
- **[note]** 4 synergy tier(s) never activated: Arcane 5, Beast 5, Steel 5, Undead 5. Team size is 4, and synergies count distinct unit types, so a 5-unit tier is unreachable. Re-run with `--team-size 5` or larger to measure them.

## Regressions

No previous report to compare against. This run becomes the baseline.

## Outcomes

| Result | Share |
| --- | --- |
| Player win | 50.1% |
| Enemy win | 49.8% |
| Draw | 0.1% |
| Ended by wipe | 98.0% |
| Ended by timeout | 1.9% |
| Ended by mutualWipe | 0.1% |

## Battle length

| Statistic | Ticks | Seconds |
| --- | --- | --- |
| Mean | 428 | 21.4s |
| Min | 69 | 3.5s |
| Max | 1200 | 60.0s |
| p10 | 195 | 9.8s |
| p25 | 251 | 12.6s |
| p50 | 375 | 18.8s |
| p75 | 533 | 26.6s |
| p90 | 736 | 36.8s |

Distribution (each block is 100 ticks / 5s):

```
     0-99      33  #
  100-199    1105  ###################
  200-299    2278  ########################################
  300-399    2047  ####################################
  400-499    1648  #############################
  500-599    1017  ##################
  600-699     665  ############
  700-799     424  #######
  800-899     242  ####
  900-999     173  ###
1000-1099      98  ##
1100-1199      82  #
1200-1299     188  ###
```

## Merge paths

Each row is a controlled pair: identical enemy, identical supporting cast, identical battle seed — only the merge choice differs. A gap above 8pp is flagged.

| Parent | Option | Win rate | n | Gap | 95% margin | Flag |
| --- | --- | --- | --- | --- | --- | --- |
| **Bramble Stalker** (T2) | Primal Avatar | 60.3% | 300 | 19.7pp | +/-7.2pp | **over** |
|  | Verdant Colossus | 80.0% | 300 |  |  |  |
| **Plague Hound** (T2) | Bone Leviathan | 75.3% | 300 | 18.2pp | +/-7.4pp | **over** |
|  | Lich Regent | 57.2% | 300 |  |  |  |
| **Rot Knight** (T2) | Bone Leviathan | 76.3% | 300 | 17.7pp | +/-7.4pp | **over** |
|  | Lich Regent | 58.7% | 300 |  |  |  |
| **Alpha Howler** (T2) | Primal Avatar | 64.0% | 300 | 16.3pp | +/-7.1pp | **over** |
|  | Verdant Colossus | 80.3% | 300 |  |  |  |
| **Gear Artificer** (T2) | Primal Avatar | 59.2% | 300 | 14.5pp | +/-7.5pp | **over** |
|  | Titan of the Forge | 73.7% | 300 |  |  |  |
| **Iron Bulwark** (T2) | Sovereign Engine | 62.8% | 300 | 12.3pp | +/-7.3pp | **over** |
|  | Titan of the Forge | 75.2% | 300 |  |  |  |
| **Thornling** (T1) | Bramble Stalker | 40.2% | 300 | 11.8pp | +/-7.9pp | **over** |
|  | Moss Warden | 52.0% | 300 |  |  |  |
| **Void Caller** (T2) | Archon of Ash | 69.3% | 300 | 10.7pp | +/-7.6pp | **over** |
|  | Void Sovereign | 58.7% | 300 |  |  |  |
| **Dire Pup** (T1) | Alpha Howler | 47.3% | 300 | 9.2pp | +/-8.0pp | **over** |
|  | Moss Warden | 56.5% | 300 |  |  |  |
| **Scrap Sentry** (T1) | Gear Artificer | 44.7% | 300 | 8.8pp | +/-8.0pp | **over** |
|  | Iron Bulwark | 53.5% | 300 |  |  |  |
| **Blade Dancer** (T2) | Sovereign Engine | 68.0% | 300 | 6.8pp | +/-7.2pp |  |
|  | Titan of the Forge | 74.8% | 300 |  |  |  |
| **Ember Magus** (T2) | Archon of Ash | 68.8% | 300 | 6.7pp | +/-7.6pp |  |
|  | Void Sovereign | 62.2% | 300 |  |  |  |
| **Forge Apprentice** (T1) | Blade Dancer | 42.7% | 300 | 4.7pp | +/-8.0pp |  |
|  | Gear Artificer | 47.3% | 300 |  |  |  |
| **Spark Imp** (T1) | Ember Magus | 49.2% | 300 | 4.3pp | +/-8.0pp |  |
|  | Sigil Adept | 53.5% | 300 |  |  |  |
| **Rune Scribe** (T1) | Sigil Adept | 52.7% | 300 | 3.8pp | +/-8.0pp |  |
|  | Void Caller | 48.8% | 300 |  |  |  |
| **Moss Warden** (T2) | Bone Leviathan | 75.7% | 300 | 3.3pp | +/-6.7pp |  |
|  | Verdant Colossus | 79.0% | 300 |  |  |  |
| **Sigil Adept** (T2) | Archon of Ash | 68.7% | 300 | 3.0pp | +/-7.5pp |  |
|  | Sovereign Engine | 65.7% | 300 |  |  |  |
| **Crypt Weaver** (T2) | Lich Regent | 61.5% | 300 | 2.8pp | +/-7.7pp |  |
|  | Void Sovereign | 64.3% | 300 |  |  |  |
| **Grave Rat** (T1) | Crypt Weaver | 42.2% | 300 | 2.2pp | +/-7.9pp |  |
|  | Plague Hound | 40.0% | 300 |  |  |  |
| **Bone Acolyte** (T1) | Crypt Weaver | 45.3% | 300 | 1.5pp | +/-8.0pp |  |
|  | Rot Knight | 46.8% | 300 |  |  |  |

## Synergies

`Delta` is the win rate of teams running this tier minus the win rate of teams where the synergy is not active at all.

| Tag | Tier | Active win rate | n | Inactive win rate | Delta |
| --- | --- | --- | --- | --- | --- |
| Arcane | 3 | 72.2% | 1938 | 47.5% | +24.7pp |
| Arcane | 5 | — | 0 | 47.5% | — |
| Beast | 3 | 47.3% | 966 | 50.1% | -2.8pp |
| Beast | 5 | — | 0 | 50.1% | — |
| Steel | 3 | 41.4% | 944 | 50.4% | -8.9pp |
| Steel | 5 | — | 0 | 50.4% | — |
| Undead | 3 | 56.0% | 959 | 49.6% | +6.4pp |
| Undead | 5 | — | 0 | 49.6% | — |

## Units

Sorted by win rate when present. Summoned bodies are excluded. `vs tier` is the gap to the median win rate of the same tier — the only comparison that means anything, since a tier 3 unit is meant to beat a tier 1 one.

| Unit | T | Win rate | vs tier | n | Avg survival | Dmg dealt | Dmg taken | Death rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Archon of Ash | 3 | 76.9% | +13.0pp | 2614 | 13.0s | 530 | 159 | 36.8% |
| Lich Regent | 3 | 72.0% | +8.1pp | 2741 | 15.6s | 273 | 180 | 43.7% |
| Verdant Colossus | 3 | 69.6% | +5.7pp | 2653 | 27.5s | 184 | 611 | 33.6% |
| Void Sovereign | 3 | 64.5% | +0.6pp | 2657 | 13.8s | 396 | 172 | 50.2% |
| Titan of the Forge | 3 | 63.3% | -0.6pp | 2790 | 25.6s | 201 | 569 | 43.9% |
| Bone Leviathan | 3 | 61.8% | -2.1pp | 2742 | 21.8s | 285 | 446 | 55.7% |
| Ember Magus | 2 | 59.8% | +12.9pp | 2747 | 11.4s | 371 | 97 | 56.2% |
| Sovereign Engine | 3 | 59.6% | -4.3pp | 2658 | 19.1s | 274 | 299 | 53.0% |
| Primal Avatar | 3 | 56.0% | -7.9pp | 2782 | 16.0s | 220 | 269 | 62.7% |
| Void Caller | 2 | 54.0% | +7.2pp | 2797 | 11.6s | 307 | 93 | 61.4% |
| Moss Warden | 2 | 53.3% | +6.5pp | 2614 | 18.7s | 112 | 305 | 63.3% |
| Crypt Weaver | 2 | 50.1% | +3.3pp | 2671 | 12.7s | 236 | 124 | 66.8% |
| Sigil Adept | 2 | 47.5% | +0.6pp | 2655 | 15.9s | 174 | 182 | 69.2% |
| Iron Bulwark | 2 | 47.1% | +0.3pp | 2639 | 19.8s | 98 | 302 | 69.0% |
| Gear Artificer | 2 | 46.6% | -0.3pp | 2740 | 15.7s | 184 | 177 | 69.8% |
| Plague Hound | 2 | 46.0% | -0.8pp | 2597 | 11.0s | 201 | 122 | 76.4% |
| Spark Imp | 1 | 45.6% | +10.6pp | 2750 | 10.4s | 190 | 59 | 71.9% |
| Rune Scribe | 1 | 45.2% | +10.3pp | 2766 | 13.8s | 144 | 76 | 72.8% |
| Bone Acolyte | 1 | 45.2% | +10.2pp | 2639 | 11.5s | 144 | 68 | 76.7% |
| Bramble Stalker | 2 | 43.2% | -3.7pp | 2731 | 12.9s | 146 | 166 | 77.7% |
| Rot Knight | 2 | 43.0% | -3.8pp | 2715 | 14.9s | 120 | 221 | 75.7% |
| Blade Dancer | 2 | 42.4% | -4.5pp | 2662 | 11.8s | 163 | 143 | 79.0% |
| Alpha Howler | 2 | 42.1% | -4.7pp | 2660 | 11.6s | 125 | 147 | 80.1% |
| Thornling | 1 | 36.1% | +1.2pp | 2744 | 10.9s | 85 | 110 | 84.8% |
| Scrap Sentry | 1 | 33.8% | -1.2pp | 2797 | 12.4s | 54 | 156 | 86.0% |
| Dire Pup | 1 | 33.8% | -1.2pp | 2752 | 9.5s | 72 | 84 | 86.5% |
| Grave Rat | 1 | 33.1% | -1.8pp | 2687 | 8.9s | 77 | 66 | 88.6% |
| Forge Apprentice | 1 | 32.5% | -2.5pp | 2739 | 10.7s | 70 | 105 | 87.3% |

---

Reproduce with `npm run sim -- --matches 10000 --seed 42`. Balance is tuned by editing `src/data/*.json` only — no code change is needed to move any number in this report.

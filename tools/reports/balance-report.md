# THRICEBOUND balance report

Generated 2026-08-06T00:52:22.069Z — 9,000 battles in 4.3s on 4 worker(s).

| Setting | Value |
| --- | --- |
| Random matches | 3000 |
| Merge samples per option | 150 |
| Team size | 4 |
| Seed | 1 |
| Tick | 50ms |

## Warnings

- **[merge-path]** Alpha Howler: Verdant Colossus 79.3% vs Primal Avatar 60.7% — 18.7pp gap (+/-10.2pp, n=150/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Bramble Stalker: Verdant Colossus 82.0% vs Primal Avatar 63.3% — 18.7pp gap (+/-9.9pp, n=150/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Gear Artificer: Titan of the Forge 80.0% vs Primal Avatar 63.3% — 16.7pp gap (+/-10.0pp, n=150/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Iron Bulwark: Titan of the Forge 74.7% vs Sovereign Engine 63.0% — 11.7pp gap (+/-10.4pp, n=150/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Plague Hound: Bone Leviathan 76.0% vs Lich Regent 52.3% — 23.7pp gap (+/-10.5pp, n=150/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Rot Knight: Bone Leviathan 80.3% vs Lich Regent 54.7% — 25.7pp gap (+/-10.2pp, n=150/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[merge-path]** Thornling: Moss Warden 54.0% vs Bramble Stalker 44.0% — 10.0pp gap (+/-11.3pp, n=150/arm), over the 8pp limit. Within sampling noise — raise --merge-samples before acting.
- **[merge-path]** Void Caller: Archon of Ash 64.7% vs Void Sovereign 51.3% — 13.3pp gap (+/-11.1pp, n=150/arm), over the 8pp limit. The merge is an answer, not a choice.
- **[unit]** Archon of Ash (T3) wins 76.6% against a tier 3 median of 64.8% — +11.8pp, n=791.
- **[unit]** Bone Acolyte (T1) wins 47.1% against a tier 1 median of 35.4% — +11.7pp, n=793.
- **[unit]** Ember Magus (T2) wins 59.7% against a tier 2 median of 46.5% — +13.1pp, n=822.
- **[unit]** Lich Regent (T3) wins 72.8% against a tier 3 median of 64.8% — +8.0pp, n=805.
- **[unit]** Primal Avatar (T3) wins 54.9% against a tier 3 median of 64.8% — -9.8pp, n=778.
- **[unit]** Rune Scribe (T1) wins 44.7% against a tier 1 median of 35.4% — +9.4pp, n=844.
- **[unit]** Spark Imp (T1) wins 45.3% against a tier 1 median of 35.4% — +9.9pp, n=828.
- **[unit]** Void Caller (T2) wins 56.4% against a tier 2 median of 46.5% — +9.8pp, n=841.
- **[note]** 4 synergy tier(s) never activated: Arcane 5, Beast 5, Steel 5, Undead 5. Team size is 4, and synergies count distinct unit types, so a 5-unit tier is unreachable. Re-run with `--team-size 5` or larger to measure them.

## Regressions

No unit moved by 5pp or more since the previous run (2026-08-05T08:35:27.300Z, 10000 matches, seed 42).

## Outcomes

| Result | Share |
| --- | --- |
| Player win | 50.9% |
| Enemy win | 49.0% |
| Draw | 0.1% |
| Ended by wipe | 98.0% |
| Ended by timeout | 1.9% |
| Ended by mutualWipe | 0.1% |

## Battle length

| Statistic | Ticks | Seconds |
| --- | --- | --- |
| Mean | 427 | 21.4s |
| Min | 69 | 3.5s |
| Max | 1200 | 60.0s |
| p10 | 190 | 9.5s |
| p25 | 251 | 12.6s |
| p50 | 365 | 18.3s |
| p75 | 537 | 26.9s |
| p90 | 740 | 37.0s |

Distribution (each block is 100 ticks / 5s):

```
     0-99      12  #
  100-199     362  ######################
  200-299     670  ########################################
  300-399     627  #####################################
  400-499     465  ############################
  500-599     289  #################
  600-699     201  ############
  700-799     126  ########
  800-899      71  ####
  900-999      55  ###
1000-1099      36  ##
1100-1199      28  ##
1200-1299      58  ###
```

## Merge paths

Each row is a controlled pair: identical enemy, identical supporting cast, identical battle seed — only the merge choice differs. A gap above 8pp is flagged.

| Parent | Option | Win rate | n | Gap | 95% margin | Flag |
| --- | --- | --- | --- | --- | --- | --- |
| **Rot Knight** (T2) | Bone Leviathan | 80.3% | 150 | 25.7pp | +/-10.2pp | **over** |
|  | Lich Regent | 54.7% | 150 |  |  |  |
| **Plague Hound** (T2) | Bone Leviathan | 76.0% | 150 | 23.7pp | +/-10.5pp | **over** |
|  | Lich Regent | 52.3% | 150 |  |  |  |
| **Alpha Howler** (T2) | Primal Avatar | 60.7% | 150 | 18.7pp | +/-10.2pp | **over** |
|  | Verdant Colossus | 79.3% | 150 |  |  |  |
| **Bramble Stalker** (T2) | Primal Avatar | 63.3% | 150 | 18.7pp | +/-9.9pp | **over** |
|  | Verdant Colossus | 82.0% | 150 |  |  |  |
| **Gear Artificer** (T2) | Primal Avatar | 63.3% | 150 | 16.7pp | +/-10.0pp | **over** |
|  | Titan of the Forge | 80.0% | 150 |  |  |  |
| **Void Caller** (T2) | Archon of Ash | 64.7% | 150 | 13.3pp | +/-11.1pp | **over** |
|  | Void Sovereign | 51.3% | 150 |  |  |  |
| **Iron Bulwark** (T2) | Sovereign Engine | 63.0% | 150 | 11.7pp | +/-10.4pp | **over** |
|  | Titan of the Forge | 74.7% | 150 |  |  |  |
| **Thornling** (T1) | Bramble Stalker | 44.0% | 150 | 10.0pp | +/-11.3pp | over (noisy) |
|  | Moss Warden | 54.0% | 150 |  |  |  |
| **Dire Pup** (T1) | Alpha Howler | 44.7% | 150 | 7.3pp | +/-11.3pp |  |
|  | Moss Warden | 52.0% | 150 |  |  |  |
| **Spark Imp** (T1) | Ember Magus | 48.7% | 150 | 7.3pp | +/-11.3pp |  |
|  | Sigil Adept | 56.0% | 150 |  |  |  |
| **Blade Dancer** (T2) | Sovereign Engine | 67.3% | 150 | 5.3pp | +/-10.4pp |  |
|  | Titan of the Forge | 72.7% | 150 |  |  |  |
| **Scrap Sentry** (T1) | Gear Artificer | 48.7% | 150 | 4.7pp | +/-11.3pp |  |
|  | Iron Bulwark | 53.3% | 150 |  |  |  |
| **Sigil Adept** (T2) | Archon of Ash | 68.7% | 150 | 4.7pp | +/-10.7pp |  |
|  | Sovereign Engine | 64.0% | 150 |  |  |  |
| **Moss Warden** (T2) | Bone Leviathan | 80.7% | 150 | 4.0pp | +/-8.6pp |  |
|  | Verdant Colossus | 84.7% | 150 |  |  |  |
| **Rune Scribe** (T1) | Sigil Adept | 49.3% | 150 | 3.7pp | +/-11.3pp |  |
|  | Void Caller | 45.7% | 150 |  |  |  |
| **Ember Magus** (T2) | Archon of Ash | 64.3% | 150 | 3.7pp | +/-10.9pp |  |
|  | Void Sovereign | 60.7% | 150 |  |  |  |
| **Grave Rat** (T1) | Crypt Weaver | 37.3% | 150 | 2.0pp | +/-11.0pp |  |
|  | Plague Hound | 39.3% | 150 |  |  |  |
| **Bone Acolyte** (T1) | Crypt Weaver | 45.3% | 150 | 1.3pp | +/-11.3pp |  |
|  | Rot Knight | 46.7% | 150 |  |  |  |
| **Crypt Weaver** (T2) | Lich Regent | 63.3% | 150 | 0.7pp | +/-10.9pp |  |
|  | Void Sovereign | 64.0% | 150 |  |  |  |
| **Forge Apprentice** (T1) | Blade Dancer | 44.7% | 150 | 0.7pp | +/-11.3pp |  |
|  | Gear Artificer | 45.3% | 150 |  |  |  |

## Synergies

`Delta` is the win rate of teams running this tier minus the win rate of teams where the synergy is not active at all.

| Tag | Tier | Active win rate | n | Inactive win rate | Delta |
| --- | --- | --- | --- | --- | --- |
| Arcane | 3 | 73.5% | 618 | 47.3% | +26.2pp |
| Arcane | 5 | — | 0 | 47.3% | — |
| Beast | 3 | 45.8% | 275 | 50.1% | -4.3pp |
| Beast | 5 | — | 0 | 50.1% | — |
| Steel | 3 | 39.9% | 286 | 50.5% | -10.6pp |
| Steel | 5 | — | 0 | 50.5% | — |
| Undead | 3 | 57.8% | 289 | 49.6% | +8.2pp |
| Undead | 5 | — | 0 | 49.6% | — |

## Units

Sorted by win rate when present. Summoned bodies are excluded. `vs tier` is the gap to the median win rate of the same tier — the only comparison that means anything, since a tier 3 unit is meant to beat a tier 1 one.

| Unit | T | Win rate | vs tier | n | Avg survival | Dmg dealt | Dmg taken | Death rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Archon of Ash | 3 | 76.6% | +11.8pp | 791 | 12.8s | 518 | 158 | 36.5% |
| Lich Regent | 3 | 72.8% | +8.0pp | 805 | 15.5s | 273 | 181 | 43.6% |
| Verdant Colossus | 3 | 68.8% | +4.0pp | 765 | 28.1s | 188 | 623 | 33.7% |
| Void Sovereign | 3 | 65.5% | +0.7pp | 811 | 14.0s | 401 | 174 | 50.0% |
| Bone Leviathan | 3 | 64.1% | -0.7pp | 815 | 21.6s | 280 | 445 | 54.2% |
| Titan of the Forge | 3 | 63.1% | -1.7pp | 848 | 25.8s | 208 | 584 | 45.1% |
| Sovereign Engine | 3 | 60.3% | -4.5pp | 794 | 19.0s | 275 | 296 | 52.3% |
| Ember Magus | 2 | 59.7% | +13.1pp | 822 | 10.9s | 348 | 97 | 56.3% |
| Void Caller | 2 | 56.4% | +9.8pp | 841 | 11.6s | 306 | 90 | 59.5% |
| Primal Avatar | 3 | 54.9% | -9.8pp | 778 | 16.5s | 224 | 271 | 63.0% |
| Moss Warden | 2 | 53.8% | +7.3pp | 781 | 19.4s | 114 | 296 | 60.4% |
| Crypt Weaver | 2 | 51.2% | +4.7pp | 823 | 12.7s | 234 | 123 | 66.0% |
| Sigil Adept | 2 | 47.8% | +1.2pp | 785 | 15.6s | 171 | 183 | 69.2% |
| Gear Artificer | 2 | 47.5% | +1.0pp | 827 | 15.6s | 182 | 177 | 70.2% |
| Bone Acolyte | 1 | 47.1% | +11.7pp | 793 | 11.7s | 147 | 66 | 74.8% |
| Iron Bulwark | 2 | 45.6% | -1.0pp | 753 | 19.5s | 96 | 304 | 70.9% |
| Spark Imp | 1 | 45.3% | +9.9pp | 828 | 10.3s | 189 | 58 | 71.1% |
| Plague Hound | 2 | 44.9% | -1.6pp | 783 | 11.1s | 203 | 123 | 78.1% |
| Rune Scribe | 1 | 44.7% | +9.4pp | 844 | 14.1s | 148 | 75 | 72.5% |
| Blade Dancer | 2 | 43.3% | -3.3pp | 819 | 12.4s | 170 | 139 | 76.3% |
| Rot Knight | 2 | 42.2% | -4.4pp | 829 | 14.9s | 120 | 225 | 76.6% |
| Bramble Stalker | 2 | 41.8% | -4.7pp | 806 | 13.3s | 149 | 165 | 77.8% |
| Alpha Howler | 2 | 40.2% | -6.3pp | 802 | 11.4s | 126 | 147 | 80.4% |
| Thornling | 1 | 36.7% | +1.3pp | 818 | 10.8s | 84 | 112 | 85.7% |
| Scrap Sentry | 1 | 34.0% | -1.3pp | 912 | 12.0s | 51 | 157 | 86.6% |
| Grave Rat | 1 | 33.6% | -1.8pp | 809 | 8.6s | 74 | 65 | 88.3% |
| Dire Pup | 1 | 33.3% | -2.1pp | 815 | 9.8s | 75 | 83 | 85.8% |
| Forge Apprentice | 1 | 32.7% | -2.7pp | 825 | 10.9s | 73 | 105 | 88.0% |

---

Reproduce with `npm run sim -- --matches 3000 --seed 1`. Balance is tuned by editing `src/data/*.json` only — no code change is needed to move any number in this report.

# src/data

Content definitions and their loaders.

## Responsibility

The single source of truth for every gameplay number: cards, units, synergies,
relics, enemy encounters, shop and reward tables, progression curves. Content
lives in JSON; this folder also holds the TypeScript types those files satisfy
and the loader/validator that turns them into typed objects.

## Rules

- **JSON holds data, not behaviour.** No formulas, no expression strings to be
  evaluated at runtime. If a value needs computing, core computes it from
  declared inputs.
- Every JSON shape has a matching TypeScript type, and the loader validates
  against it at startup — a malformed content file should fail loudly and
  immediately, not produce a subtly broken run.
- IDs are stable strings (`unit.ember_acolyte`), never array indices. Saved runs
  and unlock records reference them.
- Loaders stay browser-API-free so `src/core` and `src/sim` can both import
  them.
- This is where "no magic numbers" gets satisfied. If a tuning value appears in
  logic, it belongs here instead.

## Conventions

One file per content category. Every file is a `{ "version": N, "<name>": [...] }`
document, and all files must agree on `version` — the loader rejects a mismatch
rather than loading a half-migrated content set.

Optionality is expressed as an explicit `null`, never an omitted key, so a
missing field is always an error rather than a silent default.

Balance changes are their own commits (`feat(data):` / `fix(data):`) so tuning
history stays readable separately from code history.

## Contents

- `schema.ts` — the types every JSON file must satisfy, plus board geometry and
  merge constants.
- `validate.ts` — validation primitives. Errors carry a field path, the reason,
  and the value received; problems are batched so one load reports them all.
- `loader.ts` — parses and cross-checks the files. Entry points are
  `loadBundledGameData()` (cached) and `loadGameData(raw)`.
- `units.json` — 28 units: 8 at tier 1, 12 at tier 2, 8 at tier 3.
- `abilities.json`, `synergies.json`, `relics.json`, `encounters.json`.
- `run.json` — the run's rules: round count, boss rounds, starting lives and
  gold, income and interest, reroll cost, reward weighting, and the shop tier
  probability table (one row per round).

## The merge graph

`UnitDef.mergesInto` is a list, not a single id, because choosing *which* way a
merge resolves is the central decision of the game. The loader enforces the
rules that keep that graph sane: merges climb exactly one tier, tier 3 is
terminal, mergeable units offer at least two distinct targets, and the graph
has no cycles.

Run `npm run data:tree` to print the current tree.

## Effects

Abilities, synergies and relics all describe what they do with the same
composable `Effect` objects — `damage`, `heal`, `shield`, `statMod`, `status`,
`summon`, and `periodic` (which nests others to express regeneration and
damage-over-time). Adding an ability should be a data edit; only a genuinely
new *kind* of effect requires a change in `src/core`.

## run.json

The one file that says how long a run is, so everything else has to line up
with it. The loader checks that: an encounter exists for every round, each
encounter's `boss` flag matches `rules.bossRounds`, there is a shop-odds row per
round, and every relic rarity has a weight — a rarity with no weight is a relic
that can never be offered.

`shopTierOdds` holds weights rather than percentages, so a relic that multiplies
one of them does not have to keep the row summing to 100.

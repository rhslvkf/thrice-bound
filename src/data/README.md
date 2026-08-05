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

One file per content category. Balance changes are their own commits
(`feat(data):` / `fix(data):`) so tuning history is readable separately from
code history.

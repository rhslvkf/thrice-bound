# src/meta

Saving, unlocks, and progression across runs.

## Responsibility

Everything that outlives a single run: persisted save data, unlocked units and
relics, run history and statistics, player settings, and the migration logic
that keeps old saves loadable.

## Rules

- **This is where browser storage lives.** `localStorage` (and portal SDK
  storage where available) is used here and nowhere else — `src/core` must stay
  free of browser APIs.
- Every save payload carries a schema version. Loading an older version runs a
  migration; loading a newer one degrades gracefully rather than throwing away
  the player's progress.
- Treat stored data as untrusted: validate on read, fall back to defaults on
  corruption, never let a bad save crash the boot sequence.
- Storage can fail or be unavailable (private browsing, quota, embedded
  iframes). The game must remain playable without persistence.
- Meta progression must not silently change battle math — anything that affects
  combat is core logic driven by `src/data` values.
- Writes are throttled and happen at run boundaries, not per frame.

## Testing

Serialization, versioning and migration are pure logic and should be unit
tested. Storage access itself is browser-facing; keep it behind a thin adapter
so the logic around it stays testable.

## Contents

- `storage.ts` — the adapter. The only place in the codebase that names
  `localStorage`, with an in-memory fallback for when it is missing or throws.
  Availability is probed with a real write, because `localStorage` exists and
  throws on first use in several embedded contexts — exactly the case a feature
  check misses.
- `save.ts` — the run in progress. Writes at phase boundaries, never per frame;
  a synchronous storage write inside the battle loop would cost frames during
  the one moment that has to stay at 60fps.

Validation lives in `src/core/run/serialize.ts`, not here: deciding what a valid
run *is* is pure logic worth unit-testing, and deciding where it lives is a
browser API that is not. A save that fails validation is deleted rather than
kept — a "continue" button that fails every press is worse than no button.

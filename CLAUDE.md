# THRICEBOUND

A single-player web browser game that combines a merge autobattler with a
deckbuilding roguelike. Target platform is HTML5 game portals — CrazyGames and
Poki — running in desktop and mid-tier mobile browsers.

Stack: Vite + TypeScript (strict) + PixiJS v8. Tests run on Vitest. No state
management library, no UI framework, no animation library — and we are not
adding any.

## Architecture invariants

These are not style preferences. Breaking one breaks battle replay, the balance
simulator, or the portal build.

1. **`src/core` does not depend on rendering, the DOM, PixiJS, or any browser
   API.** No `window`, no `document`, no `performance`, no `localStorage`, no
   `fetch`, no `canvas`. It is pure TypeScript that must run unchanged under
   plain Node, because the headless simulator runs exactly this code.
2. **`src/core` never calls `Math.random()` directly. It uses only an injected
   seeded RNG** (`src/core/rng.ts`). Every function that needs randomness takes
   an `Rng` as a parameter. A single stray `Math.random()` makes battles
   irreproducible and silently invalidates every balance run.
3. **Dependencies point one way: `render` → `core`, never `core` → `render`.**
   The renderer reads core state and draws it. Core does not know a renderer
   exists, does not emit render commands, and does not hold references to
   display objects. The same rule applies to `ui`, `audio` and `meta`.
4. **Core state is serializable.** No class instances with behaviour smuggled
   into saved state, no closures, no `Map` keys that aren't strings or numbers.
   Save/load and replay both round-trip through JSON.
5. **Time is injected.** Core advances via an explicit delta passed in by the
   caller; it never reads a clock. Simulation runs at whatever step size it
   likes.

## Build constraints

Portal submission rejects builds that exceed these, so they are hard limits:

| Constraint      | Limit           |
| --------------- | --------------- |
| Initial load    | ≤ 50 MB         |
| Total build     | ≤ 250 MB        |
| File count      | ≤ 1500 files    |

Practical consequences: pack sprites into atlases rather than shipping loose
files, lazy-load anything not needed for the first battle, and keep audio
procedural (`src/audio`) rather than shipping sample banks.

## Performance targets

- **60 fps on a mid-tier mobile browser.** Budget is ~16 ms per frame; assume a
  device roughly three years behind flagship.
- **Initial load under 3 seconds** on a normal connection — first frame, not
  full asset set.
- Cap `devicePixelRatio` at 2. Avoid per-frame allocation in the battle loop;
  reuse objects and pool anything spawned per tick.

## Code conventions

- **No magic numbers.** Every gameplay number lives in a JSON file under
  `src/data` or a named `config` constant. If a literal appears in logic and it
  isn't `0`, `1`, or an array index, it belongs in data. This includes damage
  values, costs, probabilities, thresholds, durations, and tuning multipliers.
- Strict TypeScript, no `any`, no non-null `!` assertions to silence the
  compiler. `unknown` plus a narrowing check instead.
- Prefer plain functions and data over classes. Classes are for things with
  genuine identity and lifecycle (the RNG, the renderer).
- Path aliases: `@core/*`, `@data/*`, `@render/*`, `@ui/*`, `@audio/*`,
  `@meta/*`.
- Named exports only, except where a tool requires a default.
- Each top-level folder has a `README.md` describing its role. Keep it current
  when the folder's responsibility shifts.

## Testing conventions

- **Every new piece of logic in `src/core` ships with unit tests in the same
  commit.** Tests live next to the source as `*.test.ts`.
- Determinism is the thing worth testing hardest: given a seed, assert the exact
  outcome. `src/core/rng.test.ts` includes a golden-sequence test — if you
  change the generator, that test must fail, and updating it is a deliberate
  decision that invalidates stored replays and balance baselines.
- Core tests run under the `node` environment and must not need a DOM.
- `src/render`, `src/ui` and `src/audio` are not unit-test targets; verify those
  by running the game.
- **The dev server is not proof the game works.** It serves modules unbundled,
  so it cannot see failures that only appear after Rollup bundles the code —
  one such bug shipped a permanently blank page while `npm run dev` looked
  fine. `npm run smoke` builds for production and checks the game starts.

## Commit conventions

Conventional Commits, imperative mood, lowercase subject, no trailing period.

```
<type>(<scope>): <subject>
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `chore`.
Scopes match the source folders: `core`, `data`, `render`, `ui`, `audio`,
`meta`, `sim`, `tools`, `assets`, plus `repo` for root-level config.

```
feat(core): add merge resolution for tier-3 units
fix(render): stop leaking sprites when a battle ends early
test(core): cover rng state snapshot round-trip
```

Rules:

- One logical change per commit; keep unrelated refactors out.
- A commit that adds `src/core` logic without its tests is incomplete.
- Body explains *why* when the reason isn't obvious from the diff. Wrap at 72
  columns.
- Never commit `node_modules/`, `dist/`, or raw asset intermediates.

## Commands

| Command          | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `npm run dev`    | Vite dev server                               |
| `npm run build`  | Type-check, then production build to `dist/`  |
| `npm test`       | Vitest, single run                            |
| `npm run smoke`  | Build, then check the built game actually runs |
| `npm run sim`    | Headless balance simulator + balance report   |
| `npm run sim:runs` | Plays whole runs headless; reports run pacing |

# src/render

PixiJS rendering layer. The only place PixiJS is imported.

## Responsibility

Turning core state into pixels: the board, the units, the scene flow. It reads
`src/core` and draws what it finds there.

## The one rule that matters

**The renderer replays; it never decides.** `RunScene` calls `runBattle`, which
simulates the whole fight in core and returns an event log. Only then does
anything get drawn. By the time the first frame appears the battle is over, so
playback speed, skipping to the end, a dropped frame or a mid-fight resize
cannot change the outcome — there is nothing left to change.

The same rule covers the run around the fight. `RunScene` holds a `RunState`
from `src/core/run` and nothing else: a purchase, a merge, a reroll and a reward
all go out as a run action and come back as a new state or a refusal, which is
shown to the player rather than worked around. The renderer knows what a shop
costs only because core told it.

That is also why the headless simulator and the game always agree: they run the
same code and the renderer is not part of it.

## Rules

- **Reads `src/core`, never the reverse.** Core does not import from here, does
  not know a renderer exists, and holds no references to display objects.
- Presentation-only state (tween progress, flash timers, shake) lives here.
  Anything that affects the outcome of a battle lives in core.
- Visual constants go in `config.ts`. Gameplay numbers stay in `src/data`.
- Watch the frame budget: ~16 ms on a mid-tier phone.

## Files

| File | Owns |
| --- | --- |
| `game.ts` | Boots PixiJS, builds shared services, drives the ticker. |
| `layout.ts` | Responsive layout and board perspective. Pure maths. |
| `atlas.ts` | Every shape the game draws, baked into one texture at boot. |
| `textures.ts` | `artKey` → texture, with the placeholder fallback. |
| `board.ts` | The grid surface, one `Graphics`, rebuilt only on resize. |
| `camera.ts` | Fixed framing plus shake. |
| `color.ts` | Colour blending. |
| `tween.ts` | Easings, chaining, delay. Pooled. The whole animation system. |
| `run/RunHud.ts` | Round, lives, gold, relics. Read-only. |
| `run/RewardPanel.ts` | The three relics offered after a win. |
| `particles.ts` | Fixed pool of 500 sprites. Bursts and rings. |
| `tuning.ts` | Every timing and intensity, live-mutable. |
| `replay/BattleReplayer.ts` | Walks the event log along a timeline. |
| `units/UnitView.ts` | One unit's sprites. |
| `units/UnitPool.ts` | Recycles views across spawns and deaths. |
| `effects/DamageNumbers.ts` | Pooled popups, composed from atlas digits. |
| `effects/Hitstop.ts` | Freezes scaled time; real time keeps counting. |
| `prep/UnitCard.ts` | The card: tray slot, drag ghost, merge choice. |
| `prep/PrepController.ts` | Shop row, drag lifecycle, cell highlighting, buttons. |
| `merge/MergeSequence.ts` | The five-stage merge choreography. |
| `dev/TuningPanel.ts` | Slider overlay. Dev builds only. |
| `scenes/` | The scene state machine and the four scenes. |

## Scenes

`boot → menu → run → result`, and `result` back to either `menu` or `run`.
Every legal move is listed in `ALLOWED_TRANSITIONS`; anything else throws
rather than leaving the game wedged on a screen with no explanation.

Transitions are deferred to the end of the frame, so a scene calling `goTo`
from its own `update` is not torn down with the rest of that method still to
run.

The menu and result scenes are deliberately thin. Real menus, run setup and the
reward screens belong in `src/ui`; these exist so the state machine has states.

## Layout

No design resolution and no letterboxing. A safe rectangle is derived from the
actual viewport and the board is fitted into it, so a phone in portrait and a
monitor in landscape each get a board sized for the space they have. In
portrait the board is anchored high, leaving the lower third for the shop and
hand that will sit within thumb reach.

`layout.ts` is the exception to "render is not a unit-test target": it is pure
arithmetic with no PixiJS in it, and getting it wrong puts things off-screen in
a way that is far quicker to catch in a test than by squinting at four
viewports.

## Drawing without art

No image assets exist. Every shape is generated with `Graphics` at boot and
baked into **one** render texture; colour comes from sprite tint.

A unit's tier is its silhouette — tier 1 a circle, tier 2 a pentagon, tier 3 a
star — so the board reads without a legend. Health bar, cooldown ring, tier
pips and tag icons are all sprites from the same atlas.

When art arrives, drop a texture into PixiJS's asset cache under a unit's
`artKey`. `TextureRegistry` picks it up and stops tinting it; no scene or view
changes.

## Feel

Timings and intensities live in `tuning.ts`, not in the code that uses them.
Game feel is not reasoned into place; it is dialled in by moving a slider while
playing. The dev panel edits that store live and copies the result out as JSON
to paste back over the defaults.

The merge sequence is on a hard budget — `MERGE_SEQUENCE_BUDGET_MS`, 900 ms
excluding the wait for the player's choice, enforced by a test and shown live in
the panel. It fires several times a round; a signature moment that outstays its
welcome becomes an interruption.

Two things are easy to get wrong here:

- **Cancel tweens before destroying what they animate.** A choice card can be
  picked while its own rise tween is still running; without a cancel the next
  frame writes to a destroyed display object.
- **Feed scaled time everywhere.** Tweens, particles and popups all take the
  delta the hitstop system hands out, so a freeze holds the whole frame still
  instead of letting particles sail on through it.

## Performance

Measured on the built game with every cell on the board occupied:

| Metric | Result |
| --- | --- |
| GL draw calls per frame | **2**, median and max |
| Frame time (not fill-bound) | 16.8 ms median, vsync-locked |
| JS heap over 4 s of battle | flat — collected, not grown |

Particles, measured with the pool held saturated on a software GL context
(swiftshader — no GPU, so these are pessimistic):

| Live particles | Frame time | `update()` cost |
| --- | --- | --- |
| 0 | 16.7 ms (60 fps) | 0.005 ms |
| 248 | 18.2 ms (55 fps) | 0.16 ms |
| 496 | 19.5 ms (51 fps) | 0.24 ms |

The simulation cost of a full pool is 0.24 ms — 1.5% of the frame budget. The
rest of the difference is fill rate on a software rasteriser covering the whole
viewport, which a real GPU does not charge for. All 500 share the atlas, so they
add no draw calls.

Two draw calls is the whole design working. Every sprite comes from the single
atlas and the board is one static `Graphics`, so the draw count does not move
when the unit count does.

Three things keep it there, and each is easy to break:

- **Tint, do not re-texture.** One white circle serves every tier 1 unit on
  both teams. A per-unit texture would break the batch at every swap.
- **Scale sprites, do not rebuild geometry.** A health bar is a white pixel
  with its `width` set. The cooldown ring is 32 pre-rendered frames of the
  sweep, picked by index — an arc rebuilt as `Graphics` every frame, for every
  unit, would be geometry work forty times per frame for a ring nobody is
  looking that closely at.
- **Pool views.** A battle churns through more bodies than the board has cells,
  between summons and deaths. Views are recycled, so after the first battle
  spawning allocates nothing.

## Testing

`layout.ts` and `tween.ts` have unit tests: easing curves, chain timing, the
merge budget and the tuning store are pure arithmetic, and getting them wrong
produces animation that is subtly off rather than obviously broken — exactly the
kind of bug that survives a visual check.

Everything else is verified by running the game —
and **`npm run dev` is not enough**. The dev server serves modules unbundled,
so it cannot see failures that only exist after Rollup has bundled the code.
`npm run smoke` builds for production and checks the game actually starts.

### The top-level await trap

The entry module must not use top-level `await`. PixiJS loads its environment
and renderer through dynamic `import()`; once those land in the entry chunk, a
dynamic import waits on the very module whose top-level await is still pending,
and startup deadlocks with no error and no rejection — a permanently blank
page. It reproduces only in the production build. `src/main.ts` therefore
starts the boot without awaiting it.

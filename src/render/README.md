# src/render

PixiJS rendering layer.

## Responsibility

Turning core state into pixels: the board, units and their animations, merge
and combat effects, cameras, sprite pooling, asset and atlas loading. This is
the only place PixiJS is imported.

## Rules

- **Reads `src/core`, never the reverse.** Core does not import from here, does
  not know a renderer exists, and holds no references to display objects. If
  something here needs core to change, it goes through an explicit core API —
  the renderer never mutates core state directly.
- Presentation-only state (tween progress, particle lifetimes, screen shake)
  lives here. Anything that affects the outcome of a battle lives in core.
- The renderer must tolerate core state changing between frames without warning
  — the simulator can advance many ticks per frame.
- Visual constants go in `config.ts`. Gameplay numbers stay in `src/data`.
- Watch the frame budget: ~16 ms on a mid-tier phone. Pool sprites, avoid
  per-frame allocation, cap `devicePixelRatio` at 2.

## Testing

Not a unit-test target. Verify by running the game (`npm run dev`).

## Contents

- `bootstrap.ts` — creates the PixiJS `Application` and attaches the canvas.
- `config.ts` — presentation constants.

# src/ui

HUD, menus, and reward screens.

## Responsibility

Everything the player reads and clicks outside the battle board: gold and health
readouts, deck and hand views, shop and merge panels, card-reward and relic-pick
screens, run summary, pause and settings, tooltips.

## Rules

- Reads `src/core` state; player intent goes back through explicit core APIs.
  Never mutates core state directly, and core never imports from here.
- No UI framework and no state management library — plain TypeScript against
  either PixiJS display objects or DOM overlays. Picking per-screen is fine;
  DOM suits text-heavy panels, Pixi suits anything that must sit inside the
  scene.
- Must work at portal aspect ratios, from tall phone portrait to desktop
  widescreen. Anchor to safe areas; assume notches exist.
- Touch first: hit targets sized for fingers, no hover-only affordances.
- Copy strings stay out of logic so they can be extracted for localization
  later.

## Testing

Not a unit-test target. Verify by running the game.

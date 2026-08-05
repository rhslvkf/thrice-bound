# assets

Source images and generated atlases.

## Layout

- `src/` — original art, the editable masters. Never referenced by the game at
  runtime.
- `atlas/` — packed spritesheets and their JSON metadata, produced from `src/`
  by the scripts in `tools/`. These are what the game loads.

## Rules

- **The game loads atlases, not loose files.** The portal file-count limit
  (≤ 1500) and the 3-second load target both depend on it.
- Generated output is derived — regenerating it from `assets/src` must always
  reproduce it. Don't hand-edit anything in `atlas/`.
- Watch the budget: ≤ 50 MB initial load, ≤ 250 MB total. Anything not needed
  for the first battle should be loadable later.
- Keep masters lossless (PNG); compress only on the way out through `tools/`.
- No third-party art without a license that permits commercial portal
  distribution. Record the source and license alongside anything not made
  in-house.

## Status

Empty for now.

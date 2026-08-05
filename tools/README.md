# tools

Asset post-processing scripts. **Not part of the game build.**

## Responsibility

Offline tooling that turns source art in `assets/` into what the game ships:
sprite-atlas packing, texture compression and resizing, spritesheet metadata
generation, audio parameter baking, and build-budget reporting (initial size,
total size, file count against the portal limits).

## Rules

- Nothing in `src/` may import from here, and nothing here ends up in `dist/`.
- Node scripts, run on demand — not wired into `npm run build` unless a step
  becomes genuinely required for a correct build.
- Deterministic and re-runnable: running a script twice on unchanged input
  produces identical output, so generated assets don't churn in diffs.
- Never edit files in `assets/` in place. Read sources, write derived output.
- Keep dependencies here in `devDependencies`; they must never leak into the
  shipped bundle.

## Status

Empty for now. Scripts arrive with the first real art pass.

import { bootRenderer } from '@render/bootstrap';

const root = document.getElementById('game-root');
if (!root) {
  throw new Error('#game-root is missing from index.html');
}

/**
 * Boot is started, not awaited.
 *
 * A top-level `await` here makes the entry an async module. PixiJS loads its
 * environment and renderer through dynamic `import()`, and once Rollup bundles
 * those into the entry chunk, that import waits on the very module whose
 * top-level await is still pending — a deadlock that no amount of waiting
 * resolves. It only shows up in the production build; the dev server serves
 * modules unbundled, so the cycle never forms.
 */
void bootRenderer(root).catch((error: unknown) => {
  console.error('THRICEBOUND failed to start', error);
});

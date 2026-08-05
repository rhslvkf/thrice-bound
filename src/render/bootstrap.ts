/**
 * Starts the renderer.
 *
 * A thin seam between the page and `Game`, kept so `src/main.ts` has one thing
 * to call and the smoke test has one thing to wait on.
 */

import { Game } from './game';

export async function bootRenderer(container: HTMLElement): Promise<Game> {
  const game = new Game();
  await game.start(container);
  return game;
}

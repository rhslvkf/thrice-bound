import { Application } from 'pixi.js';
import { RENDER } from './config';

/**
 * Creates the PixiJS application and attaches its canvas.
 *
 * Deliberately empty beyond that: this stage of the project only proves the
 * render pipeline boots. Scene graph construction belongs in later work, and
 * nothing here may reach into game state directly — `src/render` reads from
 * `src/core`, never the other way round.
 */
export async function bootRenderer(container: HTMLElement): Promise<Application> {
  const app = new Application();

  await app.init({
    background: RENDER.backgroundColor,
    resizeTo: container,
    antialias: false,
    // Mobile browsers throttle hard above 2x; capping keeps the fill rate
    // inside the 60fps budget on mid-tier devices.
    resolution: Math.min(globalThis.devicePixelRatio || 1, RENDER.maxResolution),
    autoDensity: true,
    preference: 'webgl',
  });

  container.appendChild(app.canvas);
  return app;
}

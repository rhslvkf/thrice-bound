/**
 * The renderer's entry point.
 *
 * Owns the PixiJS application, builds the things every scene shares — content,
 * atlas, texture registry — and drives the scene machine from the ticker.
 *
 * Nothing here reaches into `src/core` beyond reading it. The dependency runs
 * one way: this folder knows about core, core has never heard of it.
 */

import { Application } from 'pixi.js';
import { loadBundledGameData } from '../data/loader';
import { buildAtlas } from './atlas';
import type { Atlas } from './atlas';
import { RENDER } from './config';
import { computeLayout } from './layout';
import type { Layout } from './layout';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { ResultScene } from './scenes/ResultScene';
import { RunScene } from './scenes/RunScene';
import { SceneManager } from './scenes/SceneManager';
import type { SceneContext, SceneId, ScenePayload } from './scenes/types';
import { TextureRegistry } from './textures';

export class Game {
  private app: Application | null = null;
  private atlas: Atlas | null = null;
  private scenes: SceneManager | null = null;
  private context: SceneContext | null = null;

  /**
   * Boots the renderer and starts the scene machine.
   *
   * @throws {Error} if the content files fail validation, which is a build
   *   problem rather than something to paper over at runtime.
   */
  async start(container: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      background: RENDER.backgroundColor,
      resizeTo: container,
      antialias: true,
      // Mobile browsers throttle hard above 2x; capping keeps the fill rate
      // inside the 60fps budget on mid-tier devices.
      resolution: Math.min(globalThis.devicePixelRatio || 1, RENDER.maxResolution),
      autoDensity: true,
      preference: 'webgl',
    });
    container.appendChild(app.canvas);
    this.app = app;

    // Built once. Every sprite the game draws comes out of this one texture,
    // so the whole board batches.
    const atlas = buildAtlas(app.renderer);
    this.atlas = atlas;

    const data = loadBundledGameData();
    const layout = computeLayout(app.screen.width, app.screen.height);
    const scenes = new SceneManager(layout);
    this.scenes = scenes;

    const context: SceneContext = {
      data,
      atlas,
      textures: new TextureRegistry(atlas),
      layout,
      goTo: (id: SceneId, payload?: ScenePayload) => scenes.request(id, payload ?? {}),
    };
    this.context = context;

    scenes.register(new BootScene(context));
    scenes.register(new MenuScene(context));
    scenes.register(new RunScene(context));
    scenes.register(new ResultScene(context));
    app.stage.addChild(scenes.root);

    this.applyLayout(layout);
    app.renderer.on('resize', () => this.handleResize());
    app.ticker.add((ticker) => scenes.update(ticker.deltaMS));

    scenes.start('boot');
  }

  private handleResize(): void {
    const app = this.app;
    if (app === null) return;
    this.applyLayout(computeLayout(app.screen.width, app.screen.height));
  }

  private applyLayout(layout: Layout): void {
    if (this.context !== null) this.context.layout = layout;
    this.scenes?.resize(layout);
  }

  destroy(): void {
    this.scenes?.destroy();
    this.atlas?.destroy();
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.scenes = null;
    this.atlas = null;
    this.context = null;
  }
}

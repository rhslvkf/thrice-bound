/**
 * Boot.
 *
 * The atlas and content are already built by the time this runs — see
 * `game.ts`, which has to do that work before any scene can exist. This scene
 * shows a beat of branding and hands over, so the first thing a player sees is
 * not a bare canvas.
 */

import { Container, Text } from 'pixi.js';
import { COLORS } from '../config';
import type { Layout } from '../layout';
import type { Scene, SceneContext, ScenePayload } from './types';

/** How long the title holds before the menu appears. */
const BOOT_HOLD_MS = 420;

export class BootScene implements Scene {
  readonly id = 'boot' as const;
  readonly view = new Container();

  private readonly title: Text;
  private elapsedMs = 0;

  constructor(private readonly context: SceneContext) {
    this.title = new Text({
      text: 'THRICEBOUND',
      style: { fill: COLORS.accent, fontSize: 42, fontFamily: 'system-ui', letterSpacing: 8 },
    });
    this.title.anchor.set(0.5);
    this.view.addChild(this.title);
  }

  enter(_payload: ScenePayload): void {
    this.elapsedMs = 0;
    this.title.alpha = 0;
  }

  update(deltaMs: number): void {
    this.elapsedMs += deltaMs;
    this.title.alpha = Math.min(1, this.elapsedMs / BOOT_HOLD_MS);
    if (this.elapsedMs >= BOOT_HOLD_MS) this.context.goTo('menu');
  }

  resize(layout: Layout): void {
    this.title.position.set(layout.width / 2, layout.height / 2);
    this.title.style.fontSize = 42 * layout.uiScale;
  }

  exit(): void {
    // Nothing to tear down; the title is reused if boot is ever re-entered.
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

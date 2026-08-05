/**
 * Menu.
 *
 * A title and a prompt. Deliberately thin: the real menu — run setup, unlocks,
 * settings — belongs in `src/ui`, which does not exist yet. This scene's job
 * is to be the state the machine sits in before a run, and to start one.
 */

import { Container, Text } from 'pixi.js';
import { COLORS } from '../config';
import type { Layout } from '../layout';
import type { Scene, SceneContext, ScenePayload } from './types';

const TITLE_SIZE = 54;
const SUBTITLE_SIZE = 17;
const PROMPT_SIZE = 20;
/** Prompt pulse period, in milliseconds. */
const PULSE_MS = 1600;

export class MenuScene implements Scene {
  readonly id = 'menu' as const;
  readonly view = new Container();

  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly prompt: Text;
  private elapsedMs = 0;
  private readonly start = (): void => this.context.goTo('run');

  constructor(private readonly context: SceneContext) {
    this.title = new Text({
      text: 'THRICEBOUND',
      style: { fill: COLORS.accent, fontSize: TITLE_SIZE, fontFamily: 'system-ui', letterSpacing: 10 },
    });
    this.subtitle = new Text({
      text: 'merge autobattler',
      style: { fill: COLORS.textDim, fontSize: SUBTITLE_SIZE, fontFamily: 'system-ui', letterSpacing: 4 },
    });
    this.prompt = new Text({
      text: 'tap or press space to fight',
      style: { fill: COLORS.text, fontSize: PROMPT_SIZE, fontFamily: 'system-ui' },
    });
    for (const text of [this.title, this.subtitle, this.prompt]) {
      text.anchor.set(0.5);
      this.view.addChild(text);
    }
  }

  enter(_payload: ScenePayload): void {
    this.elapsedMs = 0;
    globalThis.addEventListener('pointerdown', this.start);
    globalThis.addEventListener('keydown', this.start);
  }

  exit(): void {
    globalThis.removeEventListener('pointerdown', this.start);
    globalThis.removeEventListener('keydown', this.start);
  }

  update(deltaMs: number): void {
    this.elapsedMs += deltaMs;
    // Sine rather than a hard blink, so it draws the eye without nagging.
    this.prompt.alpha = 0.55 + 0.45 * Math.sin((this.elapsedMs / PULSE_MS) * Math.PI * 2);
  }

  resize(layout: Layout): void {
    const cx = layout.width / 2;
    const cy = layout.height / 2;
    this.title.style.fontSize = TITLE_SIZE * layout.uiScale;
    this.subtitle.style.fontSize = SUBTITLE_SIZE * layout.uiScale;
    this.prompt.style.fontSize = PROMPT_SIZE * layout.uiScale;
    this.title.position.set(cx, cy - 60 * layout.uiScale);
    this.subtitle.position.set(cx, cy - 16 * layout.uiScale);
    this.prompt.position.set(cx, cy + 70 * layout.uiScale);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

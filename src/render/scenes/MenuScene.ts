/**
 * Menu.
 *
 * A title and two ways in: continue the saved run, or start a new one. Still
 * deliberately thin — run setup, unlocks and settings belong in `src/ui`, which
 * does not exist yet — but "continue" has to live somewhere, and a run the
 * player walked away from mid-round is the one thing a menu must not lose.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { RunSaveStore } from '../../meta/save';
import { COLORS } from '../config';
import type { Layout } from '../layout';
import type { Scene, SceneContext, ScenePayload } from './types';

const TITLE_SIZE = 54;
const SUBTITLE_SIZE = 17;
const BUTTON_SIZE = 19;
const HINT_SIZE = 13;
/** Prompt pulse period, in milliseconds. */
const PULSE_MS = 1600;
/** Button box, in scaled pixels. */
const BUTTON = { width: 260, height: 52, corner: 10, gap: 14 } as const;

class MenuButton {
  readonly root = new Container();
  private readonly background = new Graphics();
  private readonly label: Text;

  constructor(text: string, private accent: number, onPress: () => void) {
    this.label = new Text({
      text,
      style: { fill: COLORS.text, fontSize: BUTTON_SIZE, fontFamily: 'system-ui', letterSpacing: 3 },
    });
    this.label.anchor.set(0.5);
    this.root.addChild(this.background, this.label);
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
    this.root.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      onPress();
    });
  }

  setText(text: string): void {
    this.label.text = text;
  }

  layout(scale: number): void {
    const width = BUTTON.width * scale;
    const height = BUTTON.height * scale;
    this.label.style.fontSize = BUTTON_SIZE * scale;
    this.background.clear();
    this.background
      .roundRect(-width / 2, -height / 2, width, height, BUTTON.corner * scale)
      .fill({ color: COLORS.buttonFill })
      .stroke({ width: Math.max(1.5, 2 * scale), color: this.accent, alpha: 0.9 });
  }
}

export class MenuScene implements Scene {
  readonly id = 'menu' as const;
  readonly view = new Container();

  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly hint: Text;
  private readonly continueButton: MenuButton;
  private readonly newRunButton: MenuButton;
  private readonly saves: RunSaveStore;
  private elapsedMs = 0;
  private hasSave = false;

  constructor(private readonly context: SceneContext) {
    this.saves = new RunSaveStore(context.data);

    this.title = new Text({
      text: 'THRICEBOUND',
      style: { fill: COLORS.accent, fontSize: TITLE_SIZE, fontFamily: 'system-ui', letterSpacing: 10 },
    });
    this.subtitle = new Text({
      text: 'merge autobattler',
      style: { fill: COLORS.textDim, fontSize: SUBTITLE_SIZE, fontFamily: 'system-ui', letterSpacing: 4 },
    });
    this.hint = new Text({
      text: '',
      style: { fill: COLORS.textDim, fontSize: HINT_SIZE, fontFamily: 'system-ui' },
    });
    for (const text of [this.title, this.subtitle, this.hint]) {
      text.anchor.set(0.5);
      this.view.addChild(text);
    }

    this.continueButton = new MenuButton('CONTINUE', COLORS.accent, () =>
      this.context.goTo('run', { resume: true }),
    );
    this.newRunButton = new MenuButton('NEW RUN', COLORS.cardBorder, () =>
      this.context.goTo('run'),
    );
    this.view.addChild(this.continueButton.root, this.newRunButton.root);
  }

  enter(_payload: ScenePayload): void {
    this.elapsedMs = 0;
    // Checked on entry rather than held: the player may have finished a run
    // since the last time this scene was up, which clears the save.
    this.hasSave = this.saves.hasSave();
    this.continueButton.root.visible = this.hasSave;

    const saved = this.hasSave ? this.saves.load() : null;
    if (saved !== null) {
      this.continueButton.setText(`CONTINUE · ROUND ${saved.round}`);
      this.hint.text = `${saved.lives} lives · ${saved.gold} gold · ${saved.relicIds.length} relics`;
    } else {
      // `load` deletes an unreadable save, so a stale button is not offered.
      this.hasSave = false;
      this.continueButton.root.visible = false;
      this.hint.text = 'a seed decides every shop and every relic offered';
    }

    this.resize(this.context.layout);
  }

  exit(): void {
    // Nothing global to detach: both entry points are buttons.
  }

  update(deltaMs: number): void {
    this.elapsedMs += deltaMs;
    // Sine rather than a hard blink, so it draws the eye without nagging.
    const primary = this.hasSave ? this.continueButton : this.newRunButton;
    primary.root.alpha = 0.78 + 0.22 * Math.sin((this.elapsedMs / PULSE_MS) * Math.PI * 2);
  }

  resize(layout: Layout): void {
    const cx = layout.width / 2;
    const cy = layout.height / 2;
    const scale = layout.uiScale;

    this.title.style.fontSize = TITLE_SIZE * scale;
    this.subtitle.style.fontSize = SUBTITLE_SIZE * scale;
    this.hint.style.fontSize = HINT_SIZE * scale;
    this.title.position.set(cx, cy - 110 * scale);
    this.subtitle.position.set(cx, cy - 66 * scale);

    this.continueButton.layout(scale);
    this.newRunButton.layout(scale);

    const step = (BUTTON.height + BUTTON.gap) * scale;
    const buttons = this.hasSave
      ? [this.continueButton, this.newRunButton]
      : [this.newRunButton];
    buttons.forEach((button, index) => {
      button.root.position.set(cx, cy + 10 * scale + index * step);
    });

    this.hint.position.set(cx, cy + 10 * scale + buttons.length * step + 6 * scale);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

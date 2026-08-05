/**
 * Result.
 *
 * Reports the outcome and offers the way back round the loop. Reads the
 * finished `BattleResult` it was handed; it does not re-run anything.
 */

import { Container, Text } from 'pixi.js';
import type { BattleResult } from '../../core/battle/index';
import { BATTLE } from '../../core/config';
import { COLORS } from '../config';
import type { Layout } from '../layout';
import type { Scene, SceneContext, ScenePayload } from './types';

const HEADLINE_SIZE = 46;
const DETAIL_SIZE = 17;
const PROMPT_SIZE = 18;

const HEADLINES: Readonly<Record<string, string>> = {
  player: 'VICTORY',
  enemy: 'DEFEAT',
  draw: 'DRAW',
};

const REASONS: Readonly<Record<string, string>> = {
  wipe: 'the board was cleared',
  mutualWipe: 'both sides fell on the same tick',
  timeout: 'time ran out; the healthier side took it',
};

export class ResultScene implements Scene {
  readonly id = 'result' as const;
  readonly view = new Container();

  private readonly headline: Text;
  private readonly detail: Text;
  private readonly prompt: Text;
  private readonly again = (): void => this.context.goTo('run');

  constructor(private readonly context: SceneContext) {
    this.headline = new Text({
      text: '',
      style: { fill: COLORS.text, fontSize: HEADLINE_SIZE, fontFamily: 'system-ui', letterSpacing: 6 },
    });
    this.detail = new Text({
      text: '',
      style: { fill: COLORS.textDim, fontSize: DETAIL_SIZE, fontFamily: 'system-ui', align: 'center' },
    });
    this.prompt = new Text({
      text: 'tap or press any key to fight again',
      style: { fill: COLORS.text, fontSize: PROMPT_SIZE, fontFamily: 'system-ui' },
    });
    for (const text of [this.headline, this.detail, this.prompt]) {
      text.anchor.set(0.5);
      this.view.addChild(text);
    }
  }

  enter(payload: ScenePayload): void {
    const battle = payload.battle;
    this.headline.text = HEADLINES[battle?.outcome ?? 'draw'] ?? 'DRAW';
    this.headline.style.fill =
      battle?.outcome === 'player'
        ? COLORS.team.player
        : battle?.outcome === 'enemy'
          ? COLORS.team.enemy
          : COLORS.text;
    this.detail.text = this.describe(battle);

    globalThis.addEventListener('pointerdown', this.again);
    globalThis.addEventListener('keydown', this.again);
  }

  exit(): void {
    globalThis.removeEventListener('pointerdown', this.again);
    globalThis.removeEventListener('keydown', this.again);
  }

  update(_deltaMs: number): void {
    // Static; nothing to advance.
  }

  resize(layout: Layout): void {
    const cx = layout.width / 2;
    const cy = layout.height / 2;
    this.headline.style.fontSize = HEADLINE_SIZE * layout.uiScale;
    this.detail.style.fontSize = DETAIL_SIZE * layout.uiScale;
    this.prompt.style.fontSize = PROMPT_SIZE * layout.uiScale;
    this.headline.position.set(cx, cy - 54 * layout.uiScale);
    this.detail.position.set(cx, cy + 4 * layout.uiScale);
    this.prompt.position.set(cx, cy + 78 * layout.uiScale);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }

  private describe(battle: BattleResult | undefined): string {
    if (battle === undefined) return '';
    const seconds = ((battle.ticks * BATTLE.tickMs) / BATTLE.msPerSecond).toFixed(1);
    const survivors = battle.finalState.units.filter((unit) => unit.alive);
    const names = survivors
      .map((unit) => this.context.data.units.get(unit.defId)?.name ?? unit.defId)
      .join(', ');

    return [
      REASONS[battle.reason] ?? battle.reason,
      `${battle.ticks} ticks · ${seconds}s · ${battle.events.length} events`,
      survivors.length === 0 ? 'no survivors' : `still standing: ${names}`,
    ].join('\n');
  }
}

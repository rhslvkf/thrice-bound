/**
 * Result.
 *
 * The end of a run: how far it got, what it carried, and how each round went.
 * Reads the finished {@link RunState} it was handed and re-runs nothing.
 *
 * The round-by-round list is the point. A roguelike's post-run screen is where
 * a player works out what went wrong, and "round 9, lost, 3 lives" answers that
 * better than a headline does.
 */

import { Container, Text } from 'pixi.js';
import type { RunState } from '../../core/run/index';
import { BATTLE } from '../../core/config';
import { COLORS } from '../config';
import type { Layout } from '../layout';
import type { Scene, SceneContext, ScenePayload } from './types';

const HEADLINE_SIZE = 44;
const DETAIL_SIZE = 16;
const LIST_SIZE = 13;
const PROMPT_SIZE = 17;

export class ResultScene implements Scene {
  readonly id = 'result' as const;
  readonly view = new Container();

  private readonly headline: Text;
  private readonly detail: Text;
  private readonly rounds: Text;
  private readonly relics: Text;
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
    this.rounds = new Text({
      text: '',
      style: {
        fill: COLORS.textDim,
        fontSize: LIST_SIZE,
        fontFamily: 'ui-monospace, monospace',
        align: 'center',
        lineHeight: LIST_SIZE * 1.5,
      },
    });
    this.relics = new Text({
      text: '',
      style: {
        fill: COLORS.accent,
        fontSize: LIST_SIZE,
        fontFamily: 'system-ui',
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 420,
      },
    });
    this.prompt = new Text({
      text: 'tap or press any key to start another run',
      style: { fill: COLORS.text, fontSize: PROMPT_SIZE, fontFamily: 'system-ui' },
    });
    for (const text of [this.headline, this.detail, this.rounds, this.relics, this.prompt]) {
      text.anchor.set(0.5);
      this.view.addChild(text);
    }
  }

  enter(payload: ScenePayload): void {
    const run = payload.run;
    const won = run?.result === 'victory';

    this.headline.text = run === undefined ? 'RUN OVER' : won ? 'THRICEBOUND' : 'DEFEAT';
    this.headline.style.fill = won ? COLORS.team.player : COLORS.team.enemy;
    this.detail.text = this.describe(run);
    this.rounds.text = this.roundList(run);
    this.relics.text = this.relicList(run);

    globalThis.addEventListener('pointerdown', this.again);
    globalThis.addEventListener('keydown', this.again);
    this.resize(this.context.layout);
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
    const scale = layout.uiScale;
    const top = layout.safe.y + layout.safe.height * 0.08;

    this.headline.style.fontSize = HEADLINE_SIZE * scale;
    this.detail.style.fontSize = DETAIL_SIZE * scale;
    this.rounds.style.fontSize = LIST_SIZE * scale;
    this.rounds.style.lineHeight = LIST_SIZE * scale * 1.5;
    this.relics.style.fontSize = LIST_SIZE * scale;
    this.relics.style.wordWrapWidth = layout.safe.width * 0.9;
    this.prompt.style.fontSize = PROMPT_SIZE * scale;

    this.headline.position.set(cx, top + 26 * scale);
    this.detail.position.set(cx, top + 76 * scale);
    this.rounds.position.set(cx, top + 76 * scale + this.detail.height / 2 + this.rounds.height / 2 + 18 * scale);
    this.relics.position.set(
      cx,
      this.rounds.position.y + this.rounds.height / 2 + this.relics.height / 2 + 16 * scale,
    );
    this.prompt.position.set(cx, layout.safe.y + layout.safe.height - 24 * scale);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }

  private describe(run: RunState | undefined): string {
    if (run === undefined) return '';
    const rules = this.context.data.run.rules;
    const wins = run.history.filter((round) => round.outcome === 'player').length;
    const seconds = (
      (run.history.reduce((sum, round) => sum + round.ticks, 0) * BATTLE.tickMs) /
      BATTLE.msPerSecond
    ).toFixed(0);

    return [
      `round ${run.history.length} of ${rules.rounds}  ·  ${wins} won, ${run.history.length - wins} lost`,
      `${run.lives} lives left  ·  ${run.gold} gold  ·  ${seconds}s of fighting`,
      `seed ${run.seed}`,
    ].join('\n');
  }

  private roundList(run: RunState | undefined): string {
    if (run === undefined) return '';
    return run.history
      .map((round) => {
        const mark = round.outcome === 'player' ? 'W' : round.outcome === 'draw' ? '-' : 'L';
        const cost = round.livesLost > 0 ? `  -${round.livesLost}` : '';
        const boss = this.context.data.run.rules.bossRounds.includes(round.round) ? ' *' : '  ';
        return `${String(round.round).padStart(2)}${boss} ${mark}${cost}`;
      })
      .join('\n');
  }

  private relicList(run: RunState | undefined): string {
    if (run === undefined || run.relicIds.length === 0) return 'no relics';
    return run.relicIds
      .map((id) => this.context.data.relics.get(id)?.name ?? id)
      .join('  ·  ');
  }
}

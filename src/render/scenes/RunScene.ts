/**
 * The battle.
 *
 * The order of operations here is the whole architecture in miniature:
 *
 *   1. `runBattle` simulates the fight to completion in `src/core`.
 *   2. The event log it produced is handed to a `BattleReplayer`.
 *   3. This scene draws whatever the replayer says the board looks like now.
 *
 * By the time anything is drawn the battle is already decided. Playback speed,
 * skipping, dropped frames, a resize mid-fight — none of it can reach back
 * into the result, because there is nothing left to reach into.
 */

import { Container, Sprite, Text } from 'pixi.js';
import { runBattle } from '../../core/battle/index';
import type { BattleResult, Deployment, Team } from '../../core/battle/index';
import { createRng } from '../../core/rng';
import { BOARD } from '../../data/schema';
import { BoardView } from '../board';
import { Camera } from '../camera';
import { COLORS, REPLAY_SPEEDS } from '../config';
import { placeCell } from '../layout';
import type { Layout } from '../layout';
import { BattleReplayer } from '../replay/BattleReplayer';
import { UnitPool } from '../units/UnitPool';
import type { Scene, SceneContext, ScenePayload } from './types';

/** Units per side in the demo matchup. */
const TEAM_SIZE = 6;
/** Height of the team strength bar, relative to cell size. */
const STRENGTH_BAR_HEIGHT = 0.14;
const LABEL_SIZE = 15;

export class RunScene implements Scene {
  readonly id = 'run' as const;
  readonly view = new Container();

  /** Shaken as one, so the board and the units never slide apart. */
  private readonly world = new Container();
  private readonly boardView = new BoardView();
  private readonly unitLayer = new Container();
  private readonly overlay = new Container();

  private readonly strengthTrack: Sprite;
  private readonly playerStrength: Sprite;
  private readonly enemyStrength: Sprite;
  private readonly speedLabel: Text;

  private readonly pool: UnitPool;
  private readonly camera: Camera;
  private replayer: BattleReplayer | null = null;
  private result: BattleResult | null = null;
  private speedIndex = 0;

  private readonly onKey = (event: KeyboardEvent): void => this.handleKey(event);
  private readonly onPointer = (): void => this.cycleSpeed();

  constructor(private readonly context: SceneContext) {
    this.world.addChild(this.boardView.root, this.unitLayer);
    this.view.addChild(this.world, this.overlay);

    this.pool = new UnitPool(context.atlas, this.unitLayer);
    this.camera = new Camera(this.world);

    this.strengthTrack = new Sprite(context.atlas.pixel);
    this.playerStrength = new Sprite(context.atlas.pixel);
    this.enemyStrength = new Sprite(context.atlas.pixel);
    this.strengthTrack.tint = COLORS.hpTrack;
    this.playerStrength.tint = COLORS.team.player;
    this.enemyStrength.tint = COLORS.team.enemy;
    this.strengthTrack.anchor.set(0, 0.5);
    this.playerStrength.anchor.set(0, 0.5);
    // Anchored right, so the enemy bar drains toward the edge it started from.
    this.enemyStrength.anchor.set(1, 0.5);

    this.speedLabel = new Text({
      text: '',
      style: { fill: COLORS.textDim, fontSize: LABEL_SIZE, fontFamily: 'system-ui' },
    });
    this.speedLabel.anchor.set(0.5, 0);

    this.overlay.addChild(
      this.strengthTrack,
      this.playerStrength,
      this.enemyStrength,
      this.speedLabel,
    );
  }

  enter(_payload: ScenePayload): void {
    this.result = runBattle(this.context.data, this.buildSetup());
    this.replayer = new BattleReplayer(this.result, this.context.data);
    this.speedIndex = 0;
    this.replayer.setSpeed(REPLAY_SPEEDS[0] ?? 1);
    this.camera.reset();
    this.pool.releaseAll();
    this.updateSpeedLabel();

    globalThis.addEventListener('keydown', this.onKey);
    globalThis.addEventListener('pointerdown', this.onPointer);
  }

  exit(): void {
    globalThis.removeEventListener('keydown', this.onKey);
    globalThis.removeEventListener('pointerdown', this.onPointer);
    this.pool.releaseAll();
    this.replayer = null;
  }

  update(deltaMs: number): void {
    const replayer = this.replayer;
    if (replayer === null) return;

    replayer.update(deltaMs);
    this.camera.shake(replayer.takeShake());
    this.camera.update(deltaMs, this.context.layout.cellSize);

    this.syncUnits();
    this.syncStrengthBar();

    if (replayer.finished && this.result !== null) {
      this.context.goTo('result', { battle: this.result });
    }
  }

  resize(layout: Layout): void {
    this.boardView.resize(layout);

    const barHeight = layout.cellSize * STRENGTH_BAR_HEIGHT;
    const barY = layout.safe.y + barHeight;
    const barWidth = layout.safe.width;

    this.strengthTrack.position.set(layout.safe.x, barY);
    this.strengthTrack.width = barWidth;
    this.strengthTrack.height = barHeight;

    this.playerStrength.position.set(layout.safe.x, barY);
    this.playerStrength.height = barHeight;
    this.enemyStrength.position.set(layout.safe.x + barWidth, barY);
    this.enemyStrength.height = barHeight;

    this.speedLabel.style.fontSize = LABEL_SIZE * layout.uiScale;
    this.speedLabel.position.set(
      layout.width / 2,
      layout.board.y + layout.board.height + layout.cellSize * 0.35,
    );
  }

  destroy(): void {
    this.pool.destroy();
    this.boardView.destroy();
    this.view.destroy({ children: true });
  }

  // -------------------------------------------------------------------------

  /**
   * Mirrors the replayer's view models onto pooled sprites.
   *
   * Allocation-free: every unit already has a view, and every view already has
   * its sprites. This loop only assigns numbers.
   */
  private syncUnits(): void {
    const replayer = this.replayer;
    if (replayer === null) return;
    const { layout } = this.context;
    const now = replayer.timeMs;

    for (const visual of replayer.units) {
      let view = this.pool.get(visual.instanceId);
      if (view === undefined) {
        view = this.pool.acquire(visual.instanceId);
        const def = this.context.data.units.get(visual.defId);
        if (def !== undefined) {
          view.bind(visual, this.context.textures.resolve(def), COLORS.team[visual.team]);
        }
      }
      const placement = placeCell(layout, visual.renderCol, visual.renderRow);
      view.update(visual, placement, layout.cellSize, now);
      // Nearer units draw over farther ones, which is what a front view implies.
      view.root.zIndex = visual.renderRow;
    }
    this.unitLayer.sortableChildren = true;

    replayer.collectRetired((visual) => this.pool.release(visual.instanceId));
  }

  private syncStrengthBar(): void {
    const replayer = this.replayer;
    if (replayer === null) return;
    const strength = replayer.teamStrength();
    const half = this.context.layout.safe.width / 2;
    this.playerStrength.width = half * Math.max(0, Math.min(1, strength.player));
    this.enemyStrength.width = half * Math.max(0, Math.min(1, strength.enemy));
  }

  /**
   * A demo matchup.
   *
   * Random for now: there is no shop, no draft and no run state yet, so there
   * is nothing else to build a board from. When those arrive this becomes the
   * player's own board and the encounter for the round.
   */
  private buildSetup(): { seed: number; player: Deployment[]; enemy: Deployment[] } {
    const seed = Math.floor(Date.now() % 0xffff_ffff);
    const rng = createRng(seed);
    const ids = [...this.context.data.units.keys()].sort();

    // Filled across a row before starting the next, so a team spreads over the
    // board instead of stacking into one column.
    const team = (rows: readonly number[]): Deployment[] =>
      Array.from({ length: TEAM_SIZE }, (_, i) => ({
        unitId: rng.pick(ids),
        col: i % BOARD.cols,
        row: rows[Math.floor(i / BOARD.cols) % rows.length] ?? 0,
      }));

    return {
      seed,
      player: team(BOARD.playerRows),
      enemy: team(BOARD.enemyRows),
    };
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === ' ' || event.key === 'Enter') {
      this.cycleSpeed();
      return;
    }
    if (event.key === 's' || event.key === 'S') this.skip();
  }

  /**
   * Cycles playback speed.
   *
   * A placeholder for the speed control that belongs in `src/ui`. The
   * capability lives in the replayer; this is just something to drive it with
   * until there are buttons.
   */
  private cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % (REPLAY_SPEEDS.length + 1);
    if (this.speedIndex === REPLAY_SPEEDS.length) {
      this.skip();
      return;
    }
    this.replayer?.setSpeed(REPLAY_SPEEDS[this.speedIndex] ?? 1);
    this.updateSpeedLabel();
  }

  private skip(): void {
    this.replayer?.skipToEnd();
    this.updateSpeedLabel();
  }

  private updateSpeedLabel(): void {
    const speed = REPLAY_SPEEDS[this.speedIndex];
    this.speedLabel.text =
      speed === undefined ? 'skipping to result' : `${speed}x  ·  tap to change speed`;
  }
}

/** Team colour lookup, kept next to its only use. */
export function teamColor(team: Team): number {
  return COLORS.team[team];
}

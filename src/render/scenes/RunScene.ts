/**
 * The run.
 *
 * Twelve rounds of shop -> prep -> battle -> reward, driven entirely by
 * `src/core/run`. This file holds no game rules: it renders a {@link RunState},
 * sends player intent back through the run's actions, and re-renders whatever
 * comes out. A refusal is shown, not worked around.
 *
 * **shop / prep** — the board is the player's to arrange. Cards drag off the
 * shop row onto cells, units swap around the board, three matching copies light
 * up the merge button. Nothing is simulated; this is all composition.
 *
 * **battle** — the composition goes to `runBattle`, which resolves the whole
 * fight in core, and the log it returns is replayed. By the time the first frame
 * of combat is drawn the result is fixed, so none of the juice — hitstop, shake,
 * particles, playback speed — can touch it.
 *
 * **reward** — three relics, one taken.
 *
 * That is the line this file is careful about. Everything that decides anything
 * happens in `src/core` before a pixel moves; everything here is feedback about
 * a decision already made.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { runBattle } from '../../core/battle/index';
import type { BattleEvent, BattleResult } from '../../core/battle/index';
import {
  battleSetupFor,
  buyUnit,
  chooseReward,
  mergeUnits,
  moveUnit,
  rerollShop,
  resolveBattle,
  sellUnit,
  skipReward,
  startBattle,
  startRun,
  toggleLock,
  unitAt,
} from '../../core/run/index';
import type {
  Cell,
  MergeOpportunity,
  RunActionResult,
  RunState,
} from '../../core/run/index';
import { RunSaveStore } from '../../meta/save';
import type { UnitDef } from '../../data/schema';
import { BoardView } from '../board';
import { Camera } from '../camera';
import { COLORS, REPLAY_SPEEDS } from '../config';
import { DamageNumbers } from '../effects/DamageNumbers';
import { Hitstop } from '../effects/Hitstop';
import { placeCell } from '../layout';
import type { Layout } from '../layout';
import { MergeSequence } from '../merge/MergeSequence';
import { ParticleSystem } from '../particles';
import { PrepController } from '../prep/PrepController';
import { BattleReplayer } from '../replay/BattleReplayer';
import type { UnitVisual } from '../replay/BattleReplayer';
import { RewardPanel } from '../run/RewardPanel';
import { RunHud } from '../run/RunHud';
import { tuning } from '../tuning';
import { TweenManager } from '../tween';
import { UnitPool } from '../units/UnitPool';
import type { Scene, SceneContext, ScenePayload } from './types';

/** Height of the team strength bar, relative to cell size. */
const STRENGTH_BAR_HEIGHT = 0.14;
const LABEL_SIZE = 15;
/** Death burst sizes, as fractions of a cell. */
const DEATH_PARTICLE = { from: 0.13, to: 0.02, lifeMs: 420 } as const;
/** Synergy ring sizes, as fractions of a cell. */
const SYNERGY_RING = { from: 0.3 } as const;
/** How long a refusal stays on screen. */
const NOTICE_MS = 2200;

const cellKey = (cell: Cell): string => `${cell.col},${cell.row}`;

export class RunScene implements Scene {
  readonly id = 'run' as const;
  readonly view = new Container();

  /** Shaken as one, so the board and everything on it move together. */
  private readonly world = new Container();
  private readonly boardView = new BoardView();
  private readonly unitLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly overlay = new Container();
  private readonly cardLayer = new Container();

  private readonly tweens = new TweenManager();
  private readonly particles = new ParticleSystem();
  private readonly damageNumbers: DamageNumbers;
  private readonly hitstop = new Hitstop();
  private readonly camera: Camera;
  private readonly pool: UnitPool;
  private readonly prep: PrepController;
  private readonly merge: MergeSequence;
  private readonly hud: RunHud;
  private readonly rewards: RewardPanel;
  private readonly saves: RunSaveStore;

  private readonly strengthTrack: Sprite;
  private readonly playerStrength: Sprite;
  private readonly enemyStrength: Sprite;
  private readonly hint: Text;
  private readonly notice: Text;
  private readonly prepBackdrop = new Graphics();

  /**
   * The run.
   *
   * The single source of truth for this scene. Every action replaces it
   * wholesale; nothing else in the renderer holds a piece of it.
   */
  private run: RunState;
  private replayer: BattleReplayer | null = null;
  private result: BattleResult | null = null;
  private speedIndex = 0;
  private nowMs = 0;
  private noticeUntilMs = 0;

  /** Static view models for units sitting on the board between fights. */
  private readonly prepVisuals = new Map<string, UnitVisual>();

  private readonly onKey = (event: KeyboardEvent): void => this.handleKey(event);
  private readonly onPointerMove = (event: FederatedPointerEvent): void =>
    this.prep.moveDrag(event.global.x, event.global.y);
  private readonly onPointerUp = (event: FederatedPointerEvent): void =>
    this.prep.endDrag(event.global.x, event.global.y);

  constructor(private readonly context: SceneContext) {
    this.world.addChild(this.boardView.root, this.unitLayer, this.effectLayer);
    this.effectLayer.addChild(this.particles.root);
    this.view.addChild(this.prepBackdrop, this.world, this.overlay, this.cardLayer);

    this.damageNumbers = new DamageNumbers(context.atlas);
    this.effectLayer.addChild(this.damageNumbers.root);

    this.pool = new UnitPool(context.atlas, this.unitLayer);
    this.camera = new Camera(this.world);
    this.saves = new RunSaveStore(context.data);
    this.run = startRun(context.data, 1);

    this.prep = new PrepController(
      context.data,
      context.atlas,
      context.textures,
      this.tweens,
      {
        onBuy: (index, target) => this.buy(index, target),
        onMove: (from, to) => this.apply(moveUnit(this.run, from, to)),
        onSell: (cell) => this.apply(sellUnit(context.data, this.run, cell)),
        onToggleLock: (index) => this.apply(toggleLock(this.run, index)),
        onReroll: () => this.apply(rerollShop(context.data, this.run)),
        onMerge: (opportunity) => this.startMerge(opportunity),
        onFight: () => this.beginBattle(),
      },
      context.layout,
    );
    this.view.addChild(this.prep.root);

    this.merge = new MergeSequence({
      tweens: this.tweens,
      particles: this.particles,
      camera: this.camera,
      hitstop: this.hitstop,
      atlas: context.atlas,
      textures: context.textures,
      cardLayer: this.cardLayer,
      desaturateTarget: this.world,
      getLayout: () => this.context.layout,
    });

    this.hud = new RunHud(context.data, context.atlas, context.layout);
    this.rewards = new RewardPanel(
      context.data,
      context.layout,
      (relicId) => this.apply(chooseReward(context.data, this.run, relicId)),
      () => this.apply(skipReward(context.data, this.run)),
    );

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

    this.hint = new Text({
      text: '',
      style: { fill: COLORS.textDim, fontSize: LABEL_SIZE, fontFamily: 'system-ui' },
    });
    this.hint.anchor.set(0.5, 0);
    this.notice = new Text({
      text: '',
      style: { fill: COLORS.dropInvalid, fontSize: LABEL_SIZE, fontFamily: 'system-ui' },
    });
    this.notice.anchor.set(0.5, 0);
    this.notice.visible = false;

    this.overlay.addChild(
      this.strengthTrack,
      this.playerStrength,
      this.enemyStrength,
      this.hint,
      this.notice,
      this.hud.root,
    );
    this.view.addChild(this.rewards.root);

    // Drags are tracked on the scene rather than per card: a pointer that
    // leaves the card it grabbed must still be followed, and released anywhere
    // must still resolve.
    this.view.eventMode = 'static';
    this.view.on('globalpointermove', this.onPointerMove);
    this.view.on('pointerup', this.onPointerUp);
    this.view.on('pointerupoutside', this.onPointerUp);
  }

  /**
   * Starts or resumes a run.
   *
   * `payload.resume` continues the saved run; otherwise a fresh one is rolled
   * from `payload.seed`, or from a seed derived at call time when none is
   * given. The seed is the only thing that varies between two runs of this
   * build, which is what makes a shared seed worth anything.
   */
  enter(payload: ScenePayload): void {
    this.nowMs = 0;
    this.prepVisuals.clear();
    this.pool.releaseAll();
    this.particles.clear();
    this.damageNumbers.clear();
    this.tweens.cancelAll();
    this.hitstop.clear();
    this.camera.reset();
    this.merge.cancel();
    this.rewards.hide();
    this.replayer = null;
    this.result = null;

    const resumed = payload.resume === true ? this.saves.load() : null;
    if (resumed !== null) {
      this.run = resumed;
    } else {
      const seed = payload.seed ?? rollSeed();
      this.run = startRun(this.context.data, seed);
      this.saves.save(this.run);
    }

    this.prep.setEnabled(true);
    this.syncFromRun();
    this.setStrengthVisible(false);

    globalThis.addEventListener('keydown', this.onKey);
  }

  exit(): void {
    globalThis.removeEventListener('keydown', this.onKey);
    this.prep.setEnabled(false);
    this.merge.cancel();
    this.tweens.cancelAll();
    this.particles.clear();
    this.damageNumbers.clear();
    this.pool.releaseAll();
    this.replayer?.setObserver(null);
    this.replayer = null;
  }

  update(realDeltaMs: number): void {
    // One scaled delta drives everything, so a freeze holds the replay, the
    // tweens and the particles still together.
    const deltaMs = this.hitstop.apply(realDeltaMs);
    this.nowMs += deltaMs;
    const cell = this.context.layout.cellSize;

    this.tweens.update(deltaMs);
    this.particles.update(deltaMs, cell);
    this.damageNumbers.update(deltaMs, cell);

    if (this.notice.visible && this.nowMs > this.noticeUntilMs) this.notice.visible = false;

    if (this.run.phase === 'battle') this.updateBattle(deltaMs);
    else this.updatePrep();

    this.camera.update(deltaMs, cell);
  }

  resize(layout: Layout): void {
    this.boardView.resize(layout);
    this.prep.resize(layout);
    this.hud.resize(layout);
    this.rewards.resize(layout);

    const barHeight = layout.cellSize * STRENGTH_BAR_HEIGHT;
    const barY = layout.safe.y + barHeight;
    this.strengthTrack.position.set(layout.safe.x, barY);
    this.strengthTrack.width = layout.safe.width;
    this.strengthTrack.height = barHeight;
    this.playerStrength.position.set(layout.safe.x, barY);
    this.playerStrength.height = barHeight;
    this.enemyStrength.position.set(layout.safe.x + layout.safe.width, barY);
    this.enemyStrength.height = barHeight;

    const hintY = layout.board.y + layout.board.height + layout.cellSize * 2.62;
    this.hint.style.fontSize = LABEL_SIZE * layout.uiScale;
    this.hint.position.set(layout.width / 2, hintY);
    this.notice.style.fontSize = LABEL_SIZE * layout.uiScale;
    this.notice.position.set(layout.width / 2, hintY);

    this.prepBackdrop.clear();
  }

  destroy(): void {
    this.prep.destroy();
    this.merge.destroy();
    this.hud.destroy();
    this.rewards.destroy();
    this.pool.destroy();
    this.particles.destroy();
    this.damageNumbers.destroy();
    this.boardView.destroy();
    this.view.destroy({ children: true });
  }

  // -------------------------------------------------------------------------
  // Run state
  // -------------------------------------------------------------------------

  /**
   * Applies an action's outcome.
   *
   * A refusal is shown to the player and otherwise ignored — core already
   * declined to change anything, so there is nothing to undo. That is why the
   * run actions return a reason rather than throwing: a full board is a normal
   * thing to attempt, not an exception.
   */
  private apply(result: RunActionResult): void {
    if (!result.ok) {
      this.showNotice(result.reason);
      return;
    }
    this.run = result.state;
    this.saves.save(this.run);
    this.syncFromRun();
  }

  /** Re-reads everything that renders the run. Never called per frame. */
  private syncFromRun(): void {
    this.hud.sync(this.run);
    this.prep.sync(this.run);
    this.rebuildPrepViews();

    if (this.run.phase === 'reward' && this.run.rewardOffer !== null) {
      this.rewards.show(this.run.rewardOffer);
      this.prep.setEnabled(false);
    } else {
      this.rewards.hide();
      this.prep.setEnabled(this.run.phase === 'shop' || this.run.phase === 'prep');
    }

    if (this.run.phase === 'over') {
      this.context.goTo('result', { run: this.run });
      return;
    }
    this.updateHint();
  }

  /**
   * Buys a shop slot and puts it where it was dropped.
   *
   * Core places a purchase in the first free cell — it has no notion of where a
   * pointer was — so the drop target is honoured with a follow-up move. Two
   * actions rather than one because "buy" and "arrange" are separately legal,
   * and neither needs to know about the other.
   */
  private buy(slotIndex: number, target: Cell | null): void {
    const before = this.run;
    const bought = buyUnit(this.context.data, before, slotIndex);
    if (!bought.ok) {
      this.showNotice(bought.reason);
      return;
    }

    let next = bought.state;
    if (target !== null) {
      const landed = findNewUnit(before, next);
      if (landed !== null && cellKey(landed) !== cellKey(target)) {
        const moved = moveUnit(next, landed, target);
        if (moved.ok) next = moved.state;
      }
    }

    this.run = next;
    this.saves.save(this.run);
    this.syncFromRun();
  }

  private showNotice(reason: string): void {
    this.notice.text = reason;
    this.notice.visible = true;
    this.noticeUntilMs = this.nowMs + NOTICE_MS;
  }

  // -------------------------------------------------------------------------
  // Prep
  // -------------------------------------------------------------------------

  /** Rebuilds the static views for whatever is on the board. */
  private rebuildPrepViews(): void {
    if (this.run.phase === 'battle') return;
    const present = new Set<string>();

    for (const slot of this.run.board) {
      const key = cellKey(slot);
      present.add(key);
      const def = this.context.data.units.get(slot.unitId);
      if (def === undefined) continue;

      let visual = this.prepVisuals.get(key);
      if (visual === undefined || visual.defId !== slot.unitId) {
        visual = this.makePrepVisual(def, slot, key);
        this.prepVisuals.set(key, visual);
      }
      visual.col = slot.col;
      visual.row = slot.row;
      visual.renderCol = slot.col;
      visual.renderRow = slot.row;

      const view = this.pool.acquire(visual.instanceId);
      view.bind(visual, this.context.textures.resolve(def), COLORS.team.player);
      // Picking a unit up off the board is the same gesture as picking one out
      // of the shop, so the view carries the same handler.
      view.root.eventMode = 'static';
      view.root.cursor = 'grab';
      view.root.removeAllListeners('pointerdown');
      view.root.on('pointerdown', (event: FederatedPointerEvent) =>
        this.prep.beginBoardDrag({ col: slot.col, row: slot.row }, event),
      );
    }

    for (const [key, visual] of [...this.prepVisuals]) {
      if (present.has(key)) continue;
      this.pool.release(visual.instanceId);
      this.prepVisuals.delete(key);
    }
  }

  /**
   * A view model for a unit that is not in a battle.
   *
   * `UnitView` draws from a `UnitVisual`, and reusing it here means the board
   * looks identical before and after the fight starts — same silhouette, same
   * bars, same tags — rather than having a second way to draw a unit that
   * drifts out of step with the first.
   */
  private makePrepVisual(def: UnitDef, cell: Cell, key: string): UnitVisual {
    return {
      instanceId: this.prepInstanceId(key),
      defId: def.id,
      name: def.name,
      team: 'player',
      tier: def.tier,
      tags: def.tags,
      col: cell.col,
      row: cell.row,
      fromCol: cell.col,
      fromRow: cell.row,
      moveStartMs: 0,
      moveEndMs: 0,
      renderCol: cell.col,
      renderRow: cell.row,
      hp: def.stats.hp,
      maxHp: def.stats.hp,
      hpDisplay: def.stats.hp,
      shield: 0,
      alive: true,
      spawnAtMs: -1000,
      deathAtMs: -1,
      attackStartMs: -1,
      attackEndMs: -1,
      attackTargetCol: 0,
      attackTargetRow: 0,
      cooldownStartMs: -1,
      cooldownEndMs: -1,
      flashUntilMs: -1,
      healUntilMs: -1,
      knockbackX: 0,
      knockbackY: 0,
      knockbackStartMs: -1,
      knockbackEndMs: -1,
      present: true,
    };
  }

  /** Stable per-cell ids, kept clear of the battle's own instance ids. */
  private prepInstanceId(key: string): number {
    const [col = '0', row = '0'] = key.split(',');
    return 10_000 + Number(col) * 100 + Number(row);
  }

  private updatePrep(): void {
    const layout = this.context.layout;
    for (const [key, visual] of this.prepVisuals) {
      const view = this.pool.get(visual.instanceId);
      if (view === undefined) continue;
      const placement = placeCell(layout, visual.renderCol, visual.renderRow);
      view.update(visual, placement, layout.cellSize, this.nowMs);
      view.root.zIndex = visual.renderRow;

      // The merge landing punch, applied to whichever unit just arrived.
      const landing = this.merge.landingCell;
      if (landing !== null && cellKey(landing) === key && this.merge.landingProgress !== null) {
        view.setPunch(MergeSequence.landingScale(this.merge.landingProgress));
      } else {
        view.setPunch(1);
      }
    }
    this.unitLayer.sortableChildren = true;
  }

  private startMerge(opportunity: MergeOpportunity): void {
    if (this.merge.isRunning) return;

    const subjects = opportunity.cells
      .map((cell) => {
        const visual = this.prepVisuals.get(cellKey(cell));
        const view = visual === undefined ? undefined : this.pool.get(visual.instanceId);
        return view === undefined ? null : { cell, node: view.root };
      })
      .filter((subject): subject is { cell: Cell; node: Container } => subject !== null);

    this.prep.setEnabled(false);
    this.merge.play(opportunity, subjects, (chosen) => {
      // The consumed copies are gone from the board, so their views retire and
      // the winner's view is built here — in time for the landing punch.
      for (const cell of opportunity.cells) {
        const key = cellKey(cell);
        const visual = this.prepVisuals.get(key);
        if (visual !== undefined) {
          this.pool.release(visual.instanceId);
          this.prepVisuals.delete(key);
        }
      }
      this.apply(mergeUnits(this.context.data, this.run, opportunity.unitId, chosen.id));
      this.prep.setEnabled(true);
    });
  }

  private beginBattle(): void {
    const started = startBattle(this.run);
    if (!started.ok) {
      this.showNotice(started.reason);
      return;
    }

    this.run = started.state;
    this.prep.setEnabled(false);
    this.pool.releaseAll();
    this.prepVisuals.clear();

    this.result = runBattle(this.context.data, battleSetupFor(this.context.data, this.run));
    this.replayer = new BattleReplayer(this.result, this.context.data);
    this.replayer.setObserver((event, atMs) => this.onBattleEvent(event, atMs));
    this.speedIndex = 0;
    this.replayer.setSpeed(REPLAY_SPEEDS[0] ?? 1);
    this.setStrengthVisible(true);
    this.hud.sync(this.run);
    this.updateHint();
  }

  // -------------------------------------------------------------------------
  // Battle
  // -------------------------------------------------------------------------

  private updateBattle(deltaMs: number): void {
    const replayer = this.replayer;
    if (replayer === null) return;

    replayer.update(deltaMs);
    this.camera.shake(replayer.takeShake());
    this.syncUnits();
    this.syncStrengthBar();

    if (replayer.finished && this.result !== null) {
      const result = this.result;
      this.result = null;
      this.replayer = null;
      this.setStrengthVisible(false);
      this.pool.releaseAll();
      // The fight was decided before the first frame of it was drawn; this is
      // where the run finally hears about it.
      this.run = resolveBattle(this.context.data, this.run, result);
      this.saves.save(this.run);
      this.syncFromRun();
    }
  }

  /**
   * Reacts to a battle event with feedback.
   *
   * Read-only: the event has already been applied to the view model, and the
   * battle it came from finished before this scene existed.
   */
  private onBattleEvent(event: BattleEvent, atMs: number): void {
    const replayer = this.replayer;
    if (replayer === null) return;
    const layout = this.context.layout;
    const cell = layout.cellSize;

    if (event.kind === 'damage' && event.amount > 0) {
      const target = this.findVisual(event.targetId);
      if (target === undefined) return;
      const at = placeCell(layout, target.renderCol, target.renderRow);

      // Started on the body rather than above it: a popup from the back row
      // that begins high enough ends up over the strength bar, and that bar is
      // how the player reads who is winning.
      this.damageNumbers.show(event.amount, at.x, at.y, this.isBigHit(event), cell);
      this.hitstop.freeze(event.lethal ? tuning.hit.killHitstopMs : tuning.hit.hitstopMs);

      const source = event.sourceId === null ? undefined : this.findVisual(event.sourceId);
      if (source !== undefined) {
        const dx = target.renderCol - source.renderCol;
        const dy = target.renderRow - source.renderRow;
        const length = Math.hypot(dx, dy) || 1;
        target.knockbackX = (dx / length) * tuning.hit.knockbackRatio;
        target.knockbackY = (dy / length) * tuning.hit.knockbackRatio;
        target.knockbackStartMs = atMs;
        target.knockbackEndMs = atMs + tuning.hit.knockbackMs;
      }
      return;
    }

    if (event.kind === 'death') {
      const visual = this.findVisual(event.instanceId);
      if (visual === undefined) return;
      const at = placeCell(layout, visual.renderCol, visual.renderRow);
      this.particles.burst(
        {
          x: at.x,
          y: at.y,
          count: Math.round(tuning.death.particles),
          texture: this.context.atlas.shard,
          tint: COLORS.team[visual.team],
          speed: tuning.death.particleSpeed,
          lifeMs: DEATH_PARTICLE.lifeMs,
          sizeFrom: DEATH_PARTICLE.from,
          sizeTo: DEATH_PARTICLE.to,
          spin: 8,
        },
        cell,
      );
      this.camera.shake(tuning.hit.killShake);
      return;
    }

    if (event.kind === 'synergyApplied') {
      // Staggered rather than simultaneous: a row of rings firing one after
      // another reads as a list of units being affected, where all at once
      // reads as a single flash.
      event.affectedIds.forEach((id, index) => {
        this.tweens.to({
          durationMs: 0,
          delayMs: index * tuning.synergy.staggerMs,
          onComplete: () => {
            const visual = this.findVisual(id);
            if (visual === undefined) return;
            const at = placeCell(layout, visual.renderCol, visual.renderRow);
            this.particles.ring(
              {
                x: at.x,
                y: at.y,
                texture: this.context.atlas.wave,
                tint: COLORS.team[visual.team],
                fromSize: SYNERGY_RING.from,
                toSize: tuning.synergy.ringScale,
                lifeMs: tuning.synergy.ringMs,
              },
              cell,
            );
          },
        });
      });
    }
  }

  /**
   * Whether a hit is worth calling out.
   *
   * Core has no crit system, so there is no flag in the log to read. What the
   * log does show is how hard a blow landed relative to what that unit hits for
   * normally, and an ability or a buffed swing that clears the threshold is
   * exactly the moment worth emphasising. It is presentation reading the data
   * it has, not an invented mechanic.
   */
  private isBigHit(event: Extract<BattleEvent, { kind: 'damage' }>): boolean {
    if (event.sourceId === null) return false;
    const source = this.findVisual(event.sourceId);
    if (source === undefined) return false;
    const def = this.context.data.units.get(source.defId);
    if (def === undefined) return false;
    return event.amount >= def.stats.atk * tuning.damageNumbers.critThreshold;
  }

  private findVisual(instanceId: number): UnitVisual | undefined {
    return this.replayer?.units.find((unit) => unit.instanceId === instanceId);
  }

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
        view.root.eventMode = 'none';
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

  private setStrengthVisible(visible: boolean): void {
    this.strengthTrack.visible = visible;
    this.playerStrength.visible = visible;
    this.enemyStrength.visible = visible;
  }

  // -------------------------------------------------------------------------

  private handleKey(event: KeyboardEvent): void {
    if (this.run.phase !== 'battle') return;
    if (event.key === ' ' || event.key === 'Enter') this.cycleSpeed();
    if (event.key === 's' || event.key === 'S') this.skip();
  }

  /** Placeholder for the speed control that belongs in `src/ui`. */
  private cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % (REPLAY_SPEEDS.length + 1);
    if (this.speedIndex === REPLAY_SPEEDS.length) {
      this.skip();
      return;
    }
    this.replayer?.setSpeed(REPLAY_SPEEDS[this.speedIndex] ?? 1);
    this.updateHint();
  }

  private skip(): void {
    this.replayer?.skipToEnd();
    this.updateHint();
  }

  private updateHint(): void {
    if (this.run.phase === 'battle') {
      const speed = REPLAY_SPEEDS[this.speedIndex];
      this.hint.text =
        speed === undefined ? 'skipping' : `${speed}x  ·  space to change speed`;
      return;
    }
    if (this.run.phase === 'reward') {
      this.hint.text = '';
      return;
    }
    this.hint.text =
      this.run.board.length === 0
        ? 'drag a unit onto your half of the board'
        : 'three of a kind unlocks MERGE  ·  FIGHT when ready';
  }
}

/** The cell a purchase landed in: the one the new board has and the old did not. */
function findNewUnit(before: RunState, after: RunState): Cell | null {
  for (const slot of after.board) {
    if (unitAt(before.board, slot.col, slot.row) === null) {
      return { col: slot.col, row: slot.row };
    }
  }
  return null;
}

/**
 * A seed for a fresh run.
 *
 * The one place the renderer is allowed to read a clock, and only to *pick* a
 * seed — once chosen it goes into core and everything downstream is derived
 * from it. A daily challenge replaces this call with a date-derived seed and
 * nothing else changes.
 */
function rollSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0;
}

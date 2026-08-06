/**
 * The merge.
 *
 * This is the moment the game is built around, so it gets choreography rather
 * than a state change. Five stages, each timed from `tuning.merge` so the feel
 * can be dialled in with a slider rather than a rebuild:
 *
 *   a. **converge** — the three copies are drawn together, ease-in, and
 *      compress slightly past the meeting point. Ease-in matters: starting
 *      slow and accelerating reads as being pulled, where a linear slide reads
 *      as being moved.
 *   b. **hitstop** — everything stops and the screen desaturates. The pause is
 *      what makes the next frame land.
 *   c. **explosion** — particles, a ring wave, a shake.
 *   d. **choose** — the two upgrade candidates rise as cards and wait. This is
 *      the decision the whole game hangs on, so nothing here hurries it.
 *   e. **land** — the chosen unit arrives with an overshoot.
 *
 * Everything except stage (d) is on a budget: `MERGE_SEQUENCE_BUDGET_MS`, held
 * to by a test. A signature moment that outstays its welcome fires several
 * times a round and becomes an interruption.
 */

import { ColorMatrixFilter, Container } from 'pixi.js';
import type { UnitDef } from '../../data/schema';
import type { Atlas } from '../atlas';
import type { Camera } from '../camera';
import { COLORS } from '../config';
import type { Hitstop } from '../effects/Hitstop';
import type { Layout } from '../layout';
import { placeCell } from '../layout';
import type { ParticleSystem } from '../particles';
import type { Cell, MergeOpportunity } from '../../core/run/index';
import { UnitCard } from '../prep/UnitCard';
import type { TextureRegistry } from '../textures';
import { tuning } from '../tuning';
import { Easings } from '../tween';
import type { Tween, TweenManager } from '../tween';

/** Anything the sequence needs to move or emit through. */
export interface MergeStageDeps {
  readonly tweens: TweenManager;
  readonly particles: ParticleSystem;
  readonly camera: Camera;
  readonly hitstop: Hitstop;
  readonly atlas: Atlas;
  readonly textures: TextureRegistry;
  /** Layer the choice cards are added to. */
  readonly cardLayer: Container;
  /** Filtered during the hitstop, so the whole board drains of colour. */
  readonly desaturateTarget: Container;
  readonly getLayout: () => Layout;
}

/** Something the sequence can move around: a unit already on the board. */
export interface MergeSubject {
  readonly cell: Cell;
  readonly node: Container;
}

/** Particle sizes and counts that are structure rather than feel. */
const EXPLOSION = {
  sparkSizeFrom: 0.16,
  sparkSizeTo: 0.02,
  shardSizeFrom: 0.2,
  shardSizeTo: 0.04,
  shardShare: 0.45,
  spin: 9,
  lifeMs: 460,
  waveFrom: 0.35,
} as const;

/** Card width as a fraction of a cell, and how far below the merge they rise. */
const CHOICE = {
  cardWidthRatio: 1.5,
  gapRatio: 0.35,
  riseRatio: 1.5,
} as const;

export class MergeSequence {
  private readonly filter = new ColorMatrixFilter();
  private cards: UnitCard[] = [];
  /**
   * The rise tweens of the cards currently on screen.
   *
   * The player can pick during the stagger, which destroys every card while
   * some of these are still mid-flight. A tween holds the card in a closure, so
   * without cancelling them the next frame writes to a destroyed display
   * object.
   */
  private cardTweens: Tween[] = [];
  private running = false;

  /**
   * Progress of the landing punch, or `null` when nothing is landing.
   *
   * The sequence does not own the new unit's view — the scene builds that from
   * the board once the choice is applied — so it publishes the curve and lets
   * the scene apply it.
   */
  landingProgress: number | null = null;
  landingCell: Cell | null = null;

  constructor(private readonly deps: MergeStageDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Plays the sequence.
   *
   * `onResolved` is called once the player has chosen and the winner has
   * landed; the caller applies the choice to the board then.
   */
  play(
    opportunity: MergeOpportunity,
    subjects: readonly MergeSubject[],
    onResolved: (chosen: UnitDef) => void,
  ): void {
    if (this.running) return;
    this.running = true;

    const layout = this.deps.getLayout();
    const destination = opportunity.cells[0];
    if (destination === undefined) {
      this.running = false;
      return;
    }
    const centre = placeCell(layout, destination.col, destination.row);
    const cell = layout.cellSize;

    // (a) Converge. Positions are captured now, because the tween interpolates
    // from where each copy actually is rather than from where its cell is.
    const origins = subjects.map((subject) => ({
      node: subject.node,
      x: subject.node.position.x,
      y: subject.node.position.y,
    }));
    const overshoot = tuning.merge.convergeOvershoot * cell;

    this.deps.tweens
      .to({
        durationMs: tuning.merge.convergeMs,
        easing: Easings.easeInCubic,
        onUpdate: (t) => {
          for (const origin of origins) {
            // Past 1 the copies keep going a little, piling into each other.
            const reach = t * (1 + tuning.merge.convergeOvershoot);
            const dx = centre.x - origin.x;
            const dy = centre.y - origin.y;
            const length = Math.hypot(dx, dy) || 1;
            origin.node.position.set(
              origin.x + dx * Math.min(1, reach) + (dx / length) * overshoot * Math.max(0, reach - 1),
              origin.y + dy * Math.min(1, reach) + (dy / length) * overshoot * Math.max(0, reach - 1),
            );
            origin.node.scale.set(1 - 0.25 * t);
          }
        },
      })
      // (b) Hitstop, with the colour drained out of the board.
      .call(() => {
        this.deps.hitstop.freeze(tuning.merge.hitstopMs);
        this.applyDesaturation(tuning.merge.desaturation);
      })
      .wait(tuning.merge.hitstopMs)
      // (c) Explosion.
      .call(() => {
        this.clearDesaturation();
        for (const subject of subjects) subject.node.visible = false;
        this.explode(centre.x, centre.y, cell);
      })
      .wait(tuning.merge.explosionMs)
      // (d) Choices rise, and the sequence waits for a decision.
      .call(() => {
        this.showChoices(opportunity, centre.x, centre.y, (chosen) => {
          this.land(chosen, destination, centre.x, centre.y, cell, onResolved);
        });
      });
  }

  /** Called every frame by the scene while a hitstop is active. */
  private applyDesaturation(amount: number): void {
    if (amount <= 0) return;
    this.filter.reset();
    this.filter.saturate(-amount, false);
    this.deps.desaturateTarget.filters = [this.filter];
  }

  private clearDesaturation(): void {
    this.deps.desaturateTarget.filters = [];
  }

  private explode(x: number, y: number, cell: number): void {
    const { particles, camera, atlas } = this.deps;
    const total = Math.round(tuning.merge.explosionParticles);
    const shards = Math.round(total * EXPLOSION.shardShare);

    particles.burst(
      {
        x,
        y,
        count: total - shards,
        texture: atlas.spark,
        tint: COLORS.mergeFlash,
        speed: tuning.merge.explosionSpeed,
        lifeMs: EXPLOSION.lifeMs,
        sizeFrom: EXPLOSION.sparkSizeFrom,
        sizeTo: EXPLOSION.sparkSizeTo,
      },
      cell,
    );
    particles.burst(
      {
        x,
        y,
        count: shards,
        texture: atlas.shard,
        tint: COLORS.mergeWave,
        speed: tuning.merge.explosionSpeed * 0.7,
        lifeMs: EXPLOSION.lifeMs * 1.2,
        sizeFrom: EXPLOSION.shardSizeFrom,
        sizeTo: EXPLOSION.shardSizeTo,
        spin: EXPLOSION.spin,
      },
      cell,
    );
    particles.ring(
      {
        x,
        y,
        texture: atlas.wave,
        tint: COLORS.mergeWave,
        fromSize: EXPLOSION.waveFrom,
        toSize: tuning.merge.ringWaveScale,
        lifeMs: tuning.merge.ringWaveMs,
      },
      cell,
    );
    camera.shake(tuning.merge.explosionShake);
  }

  /**
   * Raises the upgrade candidates and waits.
   *
   * No timer and no default. Picking the direction a merge takes is the
   * decision the game is about; auto-resolving it would throw away the point.
   */
  private showChoices(
    opportunity: MergeOpportunity,
    x: number,
    y: number,
    onPick: (chosen: UnitDef) => void,
  ): void {
    const layout = this.deps.getLayout();
    const cardWidth = layout.cellSize * CHOICE.cardWidthRatio;
    const gap = layout.cellSize * CHOICE.gapRatio;
    const total = opportunity.options.length;
    const span = total * cardWidth + (total - 1) * gap;

    // The cards rise from the cell the merge happened in, but a merge at the
    // edge of the board would push them off screen, so the group is clamped
    // back inside the safe area.
    const half = span / 2;
    const centreX = Math.min(
      Math.max(x, layout.safe.x + half),
      layout.safe.x + layout.safe.width - half,
    );

    opportunity.options.forEach((option, index) => {
      const card = new UnitCard(this.deps.atlas);
      card.setSize(cardWidth);
      card.bind(option, this.deps.textures.resolve(option), COLORS.team.player);

      const targetX = centreX - half + cardWidth / 2 + index * (cardWidth + gap);
      const targetY = y;
      card.root.position.set(targetX, targetY + layout.cellSize * CHOICE.riseRatio);
      card.root.alpha = 0;
      card.root.eventMode = 'static';
      card.root.cursor = 'pointer';
      card.root.on('pointerdown', (event) => {
        event.stopPropagation();
        this.dismissChoices();
        onPick(option);
      });
      card.root.on('pointerover', () => card.setHighlight(true));
      card.root.on('pointerout', () => card.setHighlight(false));

      this.deps.cardLayer.addChild(card.root);
      this.cards.push(card);

      const startY = card.root.position.y;
      this.cardTweens.push(
        this.deps.tweens.to({
          durationMs: tuning.merge.cardRiseMs,
          delayMs: index * tuning.merge.cardStaggerMs,
          easing: Easings.easeOutBack,
          onUpdate: (t) => {
            card.root.alpha = Math.min(1, t * 1.4);
            card.root.position.y = startY + (targetY - startY) * t;
          },
        }),
      );
    });
  }

  private dismissChoices(): void {
    // Cancel before destroying: a tween that outlives its card writes to a
    // display object that no longer has a transform.
    for (const tween of this.cardTweens) tween.cancel();
    this.cardTweens = [];
    for (const card of this.cards) card.destroy();
    this.cards = [];
  }

  /** (e) The winner lands, overshooting its final size and settling. */
  private land(
    chosen: UnitDef,
    destination: Cell,
    x: number,
    y: number,
    cellSize: number,
    onResolved: (chosen: UnitDef) => void,
  ): void {
    const { particles, atlas } = this.deps;
    particles.ring(
      {
        x,
        y,
        texture: atlas.wave,
        tint: COLORS.team.player,
        fromSize: 0.2,
        toSize: tuning.merge.ringWaveScale * 0.6,
        lifeMs: tuning.merge.landMs,
        alphaFrom: 0.6,
      },
      cellSize,
    );

    // The board is updated first, so the scene has a view to punch by the time
    // the landing tween starts reporting progress.
    onResolved(chosen);
    this.landingCell = destination;
    this.landingProgress = 0;

    this.deps.tweens
      .to({
        durationMs: tuning.merge.landMs,
        onUpdate: (t) => {
          this.landingProgress = t;
        },
      })
      .call(() => {
        this.landingProgress = null;
        this.landingCell = null;
        this.running = false;
      });
  }

  /**
   * The landing punch: rest size, up past it, back to rest.
   *
   * Rises over the first part of the window and eases back over the rest, so
   * the peak lands early and the settle reads as weight rather than as a
   * bounce that forgot to stop.
   */
  static landingScale(progress: number): number {
    const t = Math.max(0, Math.min(1, progress));
    const rise = 0.38;
    const pulse =
      t < rise
        ? Easings.easeOutCubic(t / rise)
        : 1 - Easings.easeOutCubic((t - rise) / (1 - rise));
    return 1 + tuning.merge.landOvershoot * pulse;
  }

  cancel(): void {
    this.dismissChoices();
    this.clearDesaturation();
    this.landingProgress = null;
    this.landingCell = null;
    this.running = false;
  }

  destroy(): void {
    this.cancel();
    this.filter.destroy();
  }
}

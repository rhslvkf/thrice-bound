/**
 * Damage popups.
 *
 * Each number is a small row of digit sprites taken from the shared atlas, not
 * a `Text`. `Text` rasterises a texture per distinct string, so a battle's
 * worth of popups would upload a texture per number and break the batch at
 * every one; digits from the atlas cost nothing extra.
 *
 * Popups are pooled, and simultaneous ones are fanned apart. Several units
 * being hit on the same tick is the normal case, not the exception, and a
 * stack of numbers landing on the same pixel reads as one illegible smear.
 */

import { Container, Sprite } from 'pixi.js';
import type { Atlas } from '../atlas';
import { COLORS } from '../config';
import { Easings } from '../tween';
import { tuning } from '../tuning';

/** Simultaneous popups. Older ones are recycled once this is reached. */
const POOL_SIZE = 48;
/** Most digits a single number can show. */
const MAX_DIGITS = 5;
/**
 * Gap between digits, as a fraction of the number's height.
 *
 * Atlas digit frames are uniform boxes with the glyph centred, so the advance
 * is the frame width and this is the tracking on top of it. Kept small: too
 * much and `14` reads as two separate numbers rather than one.
 */
const DIGIT_GAP = 0.06;
/** How long two popups count as simultaneous, for fanning purposes. */
const CLUSTER_WINDOW_MS = 90;
/**
 * How far out the fan reaches before wrapping back to centre, in lanes.
 *
 * Without a cap the offset grows with the cluster, and at 4x speed a busy tick
 * flings numbers a screen-width from the unit that took the damage — a popup
 * over an empty cell is worse than one that overlaps.
 */
const MAX_FAN_LANES = 2;

interface Popup {
  readonly root: Container;
  readonly digits: Sprite[];
  active: boolean;
  ageMs: number;
  lifeMs: number;
  x: number;
  y: number;
  driftX: number;
  size: number;
}

export class DamageNumbers {
  readonly root = new Container();
  private readonly pool: Popup[] = [];
  private cursor = 0;
  /** Popups emitted inside the current cluster window, for fanning. */
  private clusterCount = 0;
  private clusterUntilMs = 0;
  private nowMs = 0;
  /** Scratch for digit measurement. Reused so `show` allocates nothing. */
  private readonly widths: number[] = new Array<number>(MAX_DIGITS).fill(0);

  constructor(private readonly atlas: Atlas) {
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const root = new Container();
      root.visible = false;
      const digits: Sprite[] = [];
      for (let d = 0; d < MAX_DIGITS; d += 1) {
        const sprite = new Sprite(atlas.digits[0]);
        sprite.anchor.set(0.5);
        sprite.visible = false;
        root.addChild(sprite);
        digits.push(sprite);
      }
      this.root.addChild(root);
      this.pool.push({
        root,
        digits,
        active: false,
        ageMs: 0,
        lifeMs: 0,
        x: 0,
        y: 0,
        driftX: 0,
        size: 0,
      });
    }
  }

  /**
   * Shows a number above a point.
   *
   * @param crit Drawn larger and in the crit colour. What counts as a crit is
   *   the caller's business — this only draws it.
   */
  show(amount: number, x: number, y: number, crit: boolean, cellSize: number): void {
    const rounded = Math.max(1, Math.round(amount));
    const popup = this.claim();
    if (popup === null) return;

    // Fan simultaneous popups apart, alternating left and right of the source
    // so a cluster spreads evenly rather than marching in one direction.
    if (this.nowMs > this.clusterUntilMs) this.clusterCount = 0;
    this.clusterUntilMs = this.nowMs + CLUSTER_WINDOW_MS;
    const rank = this.clusterCount;
    this.clusterCount += 1;
    const side = rank % 2 === 0 ? 1 : -1;
    const lane = Math.ceil(rank / 2) % (MAX_FAN_LANES + 1);
    const spread = lane * tuning.damageNumbers.spreadRatio * cellSize * side;

    popup.active = true;
    popup.ageMs = 0;
    popup.lifeMs = tuning.damageNumbers.durationMs;
    popup.x = x + spread;
    popup.y = y;
    popup.driftX = spread * 0.35;
    popup.size =
      cellSize * (crit ? tuning.damageNumbers.critScale : tuning.damageNumbers.scale);

    const text = String(rounded);
    const shown = Math.min(MAX_DIGITS, text.length);
    const gap = popup.size * DIGIT_GAP;

    // Measure first, so the number can be centred on the hit rather than
    // starting there.
    let totalWidth = 0;
    for (let i = 0; i < shown; i += 1) {
      const texture = this.atlas.digits[text.charCodeAt(i) - 48];
      this.widths[i] = texture === undefined ? 0 : (popup.size * texture.width) / texture.height;
      totalWidth += (this.widths[i] ?? 0) + (i > 0 ? gap : 0);
    }

    let penX = -totalWidth / 2;
    for (let i = 0; i < popup.digits.length; i += 1) {
      const sprite = popup.digits[i];
      if (sprite === undefined) continue;
      if (i >= shown) {
        sprite.visible = false;
        continue;
      }
      const code = text.charCodeAt(i) - 48;
      const texture = this.atlas.digits[code];
      const width = this.widths[i] ?? 0;
      if (texture === undefined || width === 0) {
        sprite.visible = false;
        continue;
      }
      sprite.texture = texture;
      sprite.visible = true;
      sprite.tint = crit ? COLORS.critNumber : COLORS.damageNumber;
      if (i > 0) penX += gap;
      sprite.position.set(penX + width / 2, 0);
      penX += width;
      // Digit frames are not square; scale by height and let width follow.
      sprite.height = popup.size;
      sprite.width = width;
    }

    popup.root.visible = true;
    popup.root.position.set(popup.x, popup.y);
  }

  /** Advances popups. Fed scaled time, so they hold still during a hitstop. */
  update(deltaMs: number, cellSize: number): void {
    this.nowMs += deltaMs;
    const rise = tuning.damageNumbers.riseRatio * cellSize;
    const fadeStart = tuning.damageNumbers.fadeStart;

    for (const popup of this.pool) {
      if (!popup.active) continue;
      popup.ageMs += deltaMs;
      if (popup.ageMs >= popup.lifeMs) {
        popup.active = false;
        popup.root.visible = false;
        continue;
      }

      const t = popup.ageMs / popup.lifeMs;
      // Rises fast then settles, rather than drifting up at a constant rate —
      // the pop is what makes it read as an impact.
      const lift = Easings.easeOutCubic(t) * rise;
      popup.root.position.set(popup.x + popup.driftX * t, popup.y - lift);
      popup.root.alpha =
        t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));
      // A brief overshoot on arrival, then settle to full size.
      const scale = t < 0.18 ? Easings.easeOutBack(t / 0.18) : 1;
      popup.root.scale.set(scale);
    }
  }

  clear(): void {
    for (const popup of this.pool) {
      popup.active = false;
      popup.root.visible = false;
    }
    this.clusterCount = 0;
  }

  private claim(): Popup | null {
    const total = this.pool.length;
    for (let i = 0; i < total; i += 1) {
      const index = (this.cursor + i) % total;
      const popup = this.pool[index];
      if (popup !== undefined && !popup.active) {
        this.cursor = (index + 1) % total;
        return popup;
      }
    }
    // Pool exhausted: recycle the oldest rather than dropping the newest, so a
    // busy tick still shows its most recent damage.
    let oldest: Popup | null = null;
    for (const popup of this.pool) {
      if (oldest === null || popup.ageMs > oldest.ageMs) oldest = popup;
    }
    return oldest;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

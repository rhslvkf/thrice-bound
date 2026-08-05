/**
 * One unit on the board.
 *
 * Everything is a `Sprite` drawn from the shared atlas — body, bars, ring,
 * pips, icons. Nothing here is a `Graphics`, and nothing is rebuilt per frame:
 * a health bar changes by setting `width`, a cooldown ring by swapping to a
 * pre-rendered frame, a colour by setting `tint`. Sprites from one texture
 * batch into one draw call, which is what lets forty units carry this much
 * furniture and still hold frame rate.
 *
 * Views are pooled. `bind` re-points an existing view at a different unit
 * rather than building a new one, so a battle full of summons and deaths
 * allocates nothing after the pool warms up.
 */

import { Container, Sprite } from 'pixi.js';
import type { UnitTag } from '../../data/schema';
import { MAX_TIER } from '../../data/schema';
import type { Atlas } from '../atlas';
import { mixColor } from '../color';
import { ANIM, COLORS, TAG_COLORS, UNIT_VIEW } from '../config';
import { tuning } from '../tuning';
import { Easings } from '../tween';
import type { CellPlacement } from '../layout';
import type { UnitVisual } from '../replay/BattleReplayer';
import type { UnitArt } from '../textures';

/** Health bar colour thresholds, as fractions of maximum. */
const HP_MID_THRESHOLD = 0.55;
const HP_LOW_THRESHOLD = 0.25;
/** How far the body lifts while lunging, relative to the lunge distance. */
const LUNGE_LIFT = 0.25;

export class UnitView {
  readonly root = new Container();

  private readonly glow = new Sprite();
  private readonly body = new Sprite();
  private readonly ringTrack = new Sprite();
  private readonly ring = new Sprite();
  private readonly hpTrack = new Sprite();
  private readonly hpFill = new Sprite();
  private readonly shieldFill = new Sprite();
  private readonly pips: Sprite[] = [];
  private readonly icons: Sprite[] = [];

  private teamColor: number = COLORS.team.player;
  private tintable = true;
  /**
   * Extra scale applied on top of everything else.
   *
   * Used by the merge landing punch, which is driven by the sequence rather
   * than by anything on the unit itself.
   */
  private punch = 1;

  constructor(private readonly atlas: Atlas) {
    for (const sprite of [this.glow, this.body, this.ringTrack, this.ring]) {
      sprite.anchor.set(0.5);
    }
    // Bars grow from their left edge, so only the anchor's x is pinned.
    for (const sprite of [this.hpTrack, this.hpFill, this.shieldFill]) {
      sprite.anchor.set(0, 0.5);
      sprite.texture = atlas.pixel;
    }
    this.glow.texture = atlas.glow;
    this.ringTrack.texture = atlas.ringTrack;
    this.ring.texture = atlas.ring[0] ?? atlas.ringTrack;

    for (let i = 0; i < MAX_TIER; i += 1) {
      const pip = new Sprite(atlas.pixel);
      pip.anchor.set(0.5);
      this.pips.push(pip);
    }
    // Two icons is the most any unit in the roster carries.
    for (let i = 0; i < 2; i += 1) {
      const icon = new Sprite(atlas.pixel);
      icon.anchor.set(0.5);
      this.icons.push(icon);
    }

    this.root.addChild(
      this.glow,
      this.ringTrack,
      this.ring,
      this.body,
      this.hpTrack,
      this.hpFill,
      this.shieldFill,
      ...this.pips,
      ...this.icons,
    );
    this.root.visible = false;
  }

  /** Points this view at a unit. Cheap enough to call on every spawn. */
  bind(visual: UnitVisual, art: UnitArt, teamColor: number): void {
    this.body.texture = art.texture;
    this.tintable = art.tintable;
    this.teamColor = teamColor;
    // A placeholder is a white silhouette and needs the team colour to mean
    // anything; real art brings its own and is left alone.
    this.body.tint = art.tintable ? teamColor : 0xffffff;

    this.glow.tint = teamColor;
    this.ringTrack.tint = COLORS.ringTrack;
    this.ring.tint = COLORS.ring;
    this.hpTrack.tint = COLORS.hpTrack;
    this.shieldFill.tint = COLORS.shield;

    for (let i = 0; i < this.pips.length; i += 1) {
      const pip = this.pips[i];
      if (pip === undefined) continue;
      pip.visible = i < visual.tier;
      pip.tint = teamColor;
    }

    for (let i = 0; i < this.icons.length; i += 1) {
      const icon = this.icons[i];
      if (icon === undefined) continue;
      const tag: UnitTag | undefined = visual.tags[i];
      icon.visible = tag !== undefined;
      if (tag !== undefined) {
        icon.texture = this.atlas.tags[tag] ?? this.atlas.pixel;
        icon.tint = TAG_COLORS[tag];
      }
    }

    this.root.visible = true;
  }

  /**
   * Syncs the view to its unit for this frame.
   *
   * Reads only: nothing here can write back into the replay or the battle.
   */
  update(visual: UnitVisual, placement: CellPlacement, cellSize: number, nowMs: number): void {
    const scale = placement.scale;
    const size = cellSize * scale;

    let x = placement.x;
    let y = placement.y;

    // Knockback: a shove away from the blow that eases back. Small — its job
    // is to make a hit feel like contact, not to move anyone.
    if (visual.knockbackStartMs >= 0 && nowMs < visual.knockbackEndMs) {
      const t =
        (nowMs - visual.knockbackStartMs) /
        Math.max(1, visual.knockbackEndMs - visual.knockbackStartMs);
      const recoil = (1 - Easings.easeOutCubic(Math.max(0, Math.min(1, t)))) * size;
      x += visual.knockbackX * recoil;
      y += visual.knockbackY * recoil;
    }

    // Attack lunge: out toward the target and back, as one sine arc.
    if (visual.attackStartMs >= 0 && nowMs < visual.attackEndMs) {
      const t = (nowMs - visual.attackStartMs) / (visual.attackEndMs - visual.attackStartMs);
      const swing = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
      const dx = visual.attackTargetCol - visual.renderCol;
      const dy = visual.attackTargetRow - visual.renderRow;
      const length = Math.hypot(dx, dy) || 1;
      const reach = size * UNIT_VIEW.attackLungeRatio * swing;
      x += (dx / length) * reach;
      y += (dy / length) * reach * LUNGE_LIFT;
    }

    this.root.position.set(x, y);

    // Fade in on spawn, out on death.
    let alpha = 1;
    if (nowMs < visual.spawnAtMs + ANIM.spawnMs) {
      alpha = Math.max(0, (nowMs - visual.spawnAtMs) / ANIM.spawnMs);
    }
    if (!visual.alive && visual.deathAtMs >= 0) {
      // Squash first, then fade: the body gives before it goes, which reads as
      // being destroyed rather than switched off.
      const since = nowMs - visual.deathAtMs;
      const squashT = Math.min(1, since / Math.max(1, tuning.death.squashMs));
      const squash = tuning.death.squashAmount * Easings.easeOutCubic(squashT);
      const fadeT = Math.min(1, since / Math.max(1, tuning.death.fadeMs));
      alpha = 1 - fadeT;
      this.root.scale.set(1 + squash * 0.5, Math.max(0.05, 1 - squash));
    } else {
      this.root.scale.set(this.punch, this.punch);
    }
    this.root.alpha = Math.max(0, Math.min(1, alpha));

    const bodySize = size * UNIT_VIEW.bodyRatio;
    this.body.width = bodySize;
    this.body.height = bodySize;

    // Hit and heal flashes ride on tint, so no extra draw call. The blend
    // decays across the window rather than holding flat and snapping off: a
    // board where several units are mid-flash at full strength loses its team
    // colours entirely, and colour is how you read who is winning.
    const base = this.tintable ? this.teamColor : 0xffffff;
    const flashMs = Math.max(1, tuning.hit.flashMs);
    if (nowMs < visual.flashUntilMs) {
      const decay = Math.min(1, (visual.flashUntilMs - nowMs) / flashMs);
      this.body.tint = mixColor(base, COLORS.hitFlash, tuning.hit.flashBlend * decay);
    } else if (nowMs < visual.healUntilMs) {
      const decay = Math.min(1, (visual.healUntilMs - nowMs) / flashMs);
      this.body.tint = mixColor(base, COLORS.healFlash, tuning.hit.flashBlend * decay);
    } else {
      this.body.tint = base;
    }

    this.glow.width = size * UNIT_VIEW.bodyRatio * 1.7;
    this.glow.height = this.glow.width;
    this.glow.alpha = visual.alive ? 0.5 : 0.2;

    this.updateRing(visual, size, nowMs);
    this.updateBars(visual, size);
    this.updateFurniture(size);
  }

  private updateRing(visual: UnitVisual, size: number, nowMs: number): void {
    const ringSize = size * UNIT_VIEW.ringRatio;
    const active =
      visual.alive &&
      visual.cooldownStartMs >= 0 &&
      nowMs >= visual.cooldownStartMs &&
      visual.cooldownEndMs > visual.cooldownStartMs;

    this.ringTrack.visible = active;
    this.ring.visible = active;
    if (!active) return;

    this.ringTrack.width = ringSize;
    this.ringTrack.height = ringSize;
    this.ring.width = ringSize;
    this.ring.height = ringSize;

    const progress = Math.min(
      1,
      (nowMs - visual.cooldownStartMs) / (visual.cooldownEndMs - visual.cooldownStartMs),
    );
    const frames = this.atlas.ring;
    const index = Math.min(frames.length - 1, Math.round(progress * (frames.length - 1)));
    const frame = frames[index];
    if (frame !== undefined) this.ring.texture = frame;
  }

  private updateBars(visual: UnitVisual, size: number): void {
    const width = size * UNIT_VIEW.hpBarWidthRatio;
    const height = size * UNIT_VIEW.hpBarHeightRatio;
    const left = -width / 2;
    const top = size * UNIT_VIEW.hpBarOffsetRatio;

    this.hpTrack.visible = visual.alive;
    this.hpFill.visible = visual.alive;
    if (!visual.alive) {
      this.shieldFill.visible = false;
      return;
    }

    this.hpTrack.position.set(left, top);
    this.hpTrack.width = width;
    this.hpTrack.height = height;

    const fraction = Math.max(0, Math.min(1, visual.hpDisplay / Math.max(1, visual.maxHp)));
    this.hpFill.position.set(left, top);
    this.hpFill.width = width * fraction;
    this.hpFill.height = height;
    this.hpFill.tint =
      fraction > HP_MID_THRESHOLD
        ? COLORS.hpHigh
        : fraction > HP_LOW_THRESHOLD
          ? COLORS.hpMid
          : COLORS.hpLow;

    // Shield sits as a thin strip above the health bar, capped at full width
    // so a huge shield cannot run off the side of the unit.
    const shieldFraction = Math.min(1, visual.shield / Math.max(1, visual.maxHp));
    this.shieldFill.visible = shieldFraction > 0;
    if (shieldFraction > 0) {
      const shieldHeight = size * UNIT_VIEW.shieldBarHeightRatio;
      this.shieldFill.position.set(left, top - height / 2 - shieldHeight / 2);
      this.shieldFill.width = width * shieldFraction;
      this.shieldFill.height = shieldHeight;
    }
  }

  private updateFurniture(size: number): void {
    const pipSize = size * UNIT_VIEW.tierPipRatio;
    const pipGap = size * UNIT_VIEW.tierPipGapRatio;
    const visiblePips = this.pips.filter((pip) => pip.visible);
    const pipSpan = visiblePips.length * pipSize + (visiblePips.length - 1) * pipGap;
    let pipX = -pipSpan / 2 + pipSize / 2;
    for (const pip of visiblePips) {
      pip.width = pipSize;
      pip.height = pipSize;
      pip.position.set(pipX, -size * UNIT_VIEW.tierPipOffsetRatio);
      pipX += pipSize + pipGap;
    }

    // Left and right of the health bar. A cell has vertical space for the
    // body, the pips and the bar and no more; the sides are still free.
    const iconSize = size * UNIT_VIEW.tagIconRatio;
    const spread = size * UNIT_VIEW.tagIconSpreadRatio;
    const iconY = size * UNIT_VIEW.tagIconOffsetRatio;
    const visibleIcons = this.icons.filter((icon) => icon.visible);
    visibleIcons.forEach((icon, index) => {
      icon.width = iconSize;
      icon.height = iconSize;
      icon.position.set(index === 0 ? -spread : spread, iconY);
    });
  }

  /** Sets the landing punch. `1` is rest size. */
  setPunch(scale: number): void {
    this.punch = scale;
  }

  /** Hides the view and hands it back to the pool. */
  release(): void {
    this.root.visible = false;
    this.root.alpha = 1;
    this.root.scale.set(1);
    this.punch = 1;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

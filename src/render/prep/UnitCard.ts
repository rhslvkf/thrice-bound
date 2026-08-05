/**
 * A unit card.
 *
 * Used in two places: the tray you drag units out of, and the pair of choices
 * a merge offers. Both want the same thing — a unit's identity readable at a
 * glance, at a size a thumb can hit.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { UnitDef, UnitTag } from '../../data/schema';
import { MAX_TIER } from '../../data/schema';
import type { Atlas } from '../atlas';
import { COLORS, TAG_COLORS } from '../config';
import type { UnitArt } from '../textures';

/** Card proportions and inner spacing, as fractions of card width. */
const CARD = {
  aspect: 1.34,
  cornerRatio: 0.1,
  bodyRatio: 0.46,
  bodyOffsetRatio: -0.08,
  nameOffsetRatio: 0.3,
  nameSizeRatio: 0.13,
  pipRatio: 0.05,
  pipGapRatio: 0.028,
  pipOffsetRatio: -0.36,
  tagRatio: 0.1,
  tagGapRatio: 0.035,
  tagOffsetRatio: 0.44,
  borderRatio: 0.022,
} as const;

export class UnitCard {
  readonly root = new Container();

  private readonly background = new Graphics();
  private readonly body = new Sprite();
  private readonly name: Text;
  private readonly pips: Sprite[] = [];
  private readonly tags: Sprite[] = [];

  private width = 0;
  private height = 0;
  private accent: number = COLORS.team.player;
  private highlighted = false;

  constructor(private readonly atlas: Atlas) {
    this.body.anchor.set(0.5);
    this.name = new Text({
      text: '',
      style: { fill: COLORS.text, fontSize: 14, fontFamily: 'system-ui', align: 'center' },
    });
    this.name.anchor.set(0.5);

    for (let i = 0; i < MAX_TIER; i += 1) {
      const pip = new Sprite(atlas.pixel);
      pip.anchor.set(0.5);
      this.pips.push(pip);
    }
    for (let i = 0; i < 2; i += 1) {
      const tag = new Sprite(atlas.pixel);
      tag.anchor.set(0.5);
      this.tags.push(tag);
    }

    this.root.addChild(this.background, this.body, this.name, ...this.pips, ...this.tags);
  }

  bind(def: UnitDef, art: UnitArt, accent: number): void {
    this.body.texture = art.texture;
    this.body.tint = art.tintable ? accent : 0xffffff;
    this.accent = accent;
    this.name.text = def.name;

    for (let i = 0; i < this.pips.length; i += 1) {
      const pip = this.pips[i];
      if (pip === undefined) continue;
      pip.visible = i < def.tier;
      pip.tint = accent;
    }
    for (let i = 0; i < this.tags.length; i += 1) {
      const sprite = this.tags[i];
      if (sprite === undefined) continue;
      const tag: UnitTag | undefined = def.tags[i];
      sprite.visible = tag !== undefined;
      if (tag !== undefined) {
        sprite.texture = this.atlas.tags[tag] ?? this.atlas.pixel;
        sprite.tint = TAG_COLORS[tag];
      }
    }
    this.redraw();
  }

  /** Sizes the card. Called on resize, not per frame. */
  setSize(width: number): void {
    this.width = width;
    this.height = width * CARD.aspect;

    this.body.width = width * CARD.bodyRatio;
    this.body.height = this.body.width;
    this.body.position.set(0, this.height * CARD.bodyOffsetRatio);

    this.name.style.fontSize = width * CARD.nameSizeRatio;
    this.name.style.wordWrap = true;
    this.name.style.wordWrapWidth = width * 0.9;
    this.name.position.set(0, this.height * CARD.nameOffsetRatio);

    const pipSize = width * CARD.pipRatio;
    const pipGap = width * CARD.pipGapRatio;
    const visiblePips = this.pips.filter((pip) => pip.visible);
    const span = visiblePips.length * pipSize + Math.max(0, visiblePips.length - 1) * pipGap;
    visiblePips.forEach((pip, index) => {
      pip.width = pipSize;
      pip.height = pipSize;
      pip.position.set(-span / 2 + pipSize / 2 + index * (pipSize + pipGap), this.height * CARD.pipOffsetRatio);
    });

    const tagSize = width * CARD.tagRatio;
    const tagGap = width * CARD.tagGapRatio;
    const visibleTags = this.tags.filter((tag) => tag.visible);
    const tagSpan = visibleTags.length * tagSize + Math.max(0, visibleTags.length - 1) * tagGap;
    visibleTags.forEach((tag, index) => {
      tag.width = tagSize;
      tag.height = tagSize;
      tag.position.set(-tagSpan / 2 + tagSize / 2 + index * (tagSize + tagGap), this.height * CARD.tagOffsetRatio);
    });

    this.redraw();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  setHighlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    this.redraw();
  }

  /** Bounds in the card's parent space, for hit testing. */
  containsPoint(localX: number, localY: number): boolean {
    const { x, y } = this.root.position;
    return (
      localX >= x - this.width / 2 &&
      localX <= x + this.width / 2 &&
      localY >= y - this.height / 2 &&
      localY <= y + this.height / 2
    );
  }

  private redraw(): void {
    if (this.width <= 0) return;
    const g = this.background;
    g.clear();
    const corner = this.width * CARD.cornerRatio;
    g.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, corner)
      .fill({ color: COLORS.cardFill })
      .stroke({
        width: this.width * CARD.borderRatio,
        color: this.highlighted ? this.accent : COLORS.cardBorder,
        alpha: this.highlighted ? 1 : 0.7,
      });
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

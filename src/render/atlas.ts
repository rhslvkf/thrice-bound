/**
 * The procedural texture atlas.
 *
 * No image assets exist yet, so every shape the game draws is generated here
 * with `Graphics` and baked into **one** render texture at boot. Frames are
 * then sub-rectangles of that single texture.
 *
 * One texture is the point. Forty units, each with a body, a health bar, a
 * cooldown ring, tier pips and tag icons, is several hundred sprites per
 * frame; if they came from separate textures the renderer would break the
 * batch at every swap. Sharing one source means the whole board can go out in
 * a handful of draw calls.
 *
 * Everything here is drawn **white**, and colour comes from sprite tint at use
 * time. Tinting does not break batching, so one circle serves every tier 1
 * unit on both teams.
 */

import { Container, Graphics, Rectangle, RenderTexture, Text, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { ATLAS } from './config';

/** Named frames the rest of the renderer asks for. */
export interface Atlas {
  /** Flat white. Scaled into bars, panels and rules — never redrawn. */
  readonly pixel: Texture;
  /** Unit bodies, indexed by tier: 1 circle, 2 pentagon, 3 star. */
  readonly shapes: Readonly<Record<number, Texture>>;
  /** Cooldown ring sweep, `ATLAS.ringSteps` frames from empty to full. */
  readonly ring: readonly Texture[];
  /** Track the ring sweeps around. */
  readonly ringTrack: Texture;
  /** Tag icons, by tag name. */
  readonly tags: Readonly<Record<string, Texture>>;
  /** Soft radial falloff, for glows and shadows. */
  readonly glow: Texture;
  /** Thin outline ring, for expanding pulse waves. */
  readonly wave: Texture;
  /** Small round particle. */
  readonly spark: Texture;
  /** Angular particle, for debris. */
  readonly shard: Texture;
  /**
   * Digit glyphs `0`-`9`.
   *
   * Damage numbers are built from these rather than from `Text`. A `Text`
   * object rasterises its own texture per distinct string, so a battle's worth
   * of popups would mean a texture upload per number and a broken batch per
   * popup. Composing from atlas digits keeps every number in the same draw
   * call as everything else.
   */
  readonly digits: readonly Texture[];
  /** The backing render texture, destroyed with the atlas. */
  readonly source: RenderTexture;
  destroy(): void;
}

interface Item {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /** Draws into a `Graphics`, or supplies a ready-made node (used by text). */
  readonly draw?: (graphics: Graphics, width: number, height: number) => void;
  readonly node?: Container;
}

// ---------------------------------------------------------------------------
// Shape drawing
// ---------------------------------------------------------------------------

/** Vertices of a regular polygon, first point at the top. */
function polygonPoints(sides: number, radius: number, cx: number, cy: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / sides;
    points.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  return points;
}

/** Vertices of a star, alternating between two radii. */
function starPoints(
  points: number,
  outer: number,
  inner: number,
  cx: number,
  cy: number,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    result.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  }
  return result;
}

/** Tier 1: a circle. The plainest shape, for the plainest units. */
function drawCircle(g: Graphics, size: number): void {
  g.circle(size / 2, size / 2, size / 2).fill(0xffffff);
}

/** Tier 2: a pentagon. More sides, more presence. */
function drawPentagon(g: Graphics, size: number): void {
  g.poly(polygonPoints(5, size / 2, size / 2, size / 2)).fill(0xffffff);
}

/** Tier 3: a star. Unmistakable at a glance, which is the whole job. */
function drawStar(g: Graphics, size: number): void {
  const outer = size / 2;
  g.poly(starPoints(5, outer, outer * 0.48, size / 2, size / 2)).fill(0xffffff);
}

/** One frame of the cooldown sweep, filled clockwise from twelve o'clock. */
function drawRingStep(g: Graphics, size: number, progress: number): void {
  if (progress <= 0) return;
  const thickness = size * ATLAS.ringThickness;
  const radius = size / 2 - thickness / 2;
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * Math.min(1, progress);

  if (progress >= 1) {
    g.circle(size / 2, size / 2, radius).stroke({ width: thickness, color: 0xffffff });
    return;
  }
  g.arc(size / 2, size / 2, radius, start, end).stroke({
    width: thickness,
    color: 0xffffff,
    cap: 'round',
  });
}

/** A thin outline ring, scaled up over its life to read as a shockwave. */
function drawWave(g: Graphics, size: number): void {
  const thickness = size * ATLAS.waveThickness;
  g.circle(size / 2, size / 2, size / 2 - thickness / 2).stroke({
    width: thickness,
    color: 0xffffff,
  });
}

/** A soft round particle. */
function drawSpark(g: Graphics, size: number): void {
  g.circle(size / 2, size / 2, size / 2).fill(0xffffff);
}

/** An angular particle, so debris does not read as a cloud of dots. */
function drawShard(g: Graphics, size: number): void {
  g.poly([size / 2, 0, size, size * 0.62, size * 0.5, size, 0, size * 0.62]).fill(0xffffff);
}

function drawRingTrack(g: Graphics, size: number): void {
  const thickness = size * ATLAS.ringThickness;
  g.circle(size / 2, size / 2, size / 2 - thickness / 2).stroke({
    width: thickness,
    color: 0xffffff,
  });
}

/**
 * Soft radial falloff, approximated by stacked translucent circles.
 *
 * PixiJS has no gradient fill for `Graphics`, and a real one is not worth a
 * shader here — twelve rings read as a smooth glow once scaled down.
 */
function drawGlow(g: Graphics, size: number): void {
  const steps = 12;
  for (let i = steps; i > 0; i -= 1) {
    const t = i / steps;
    g.circle(size / 2, size / 2, (size / 2) * t).fill({
      color: 0xffffff,
      alpha: 0.09 * (1 - t) + 0.02,
    });
  }
}

/**
 * Tag icons: four shapes distinct enough to tell apart at a few pixels.
 *
 * Distinctness at small size matters more than representation. A triangle, a
 * crescent, a diamond and a hexagon separate cleanly even when tinted and
 * scaled to a corner of a unit.
 */
const TAG_ICONS: Readonly<Record<string, (g: Graphics, size: number) => void>> = {
  Beast: (g, size) => {
    g.poly([size / 2, 0, size, size, 0, size]).fill(0xffffff);
  },
  Undead: (g, size) => {
    // A disc with a bite taken out of it, cut by an offset erase.
    g.circle(size / 2, size / 2, size / 2).fill(0xffffff);
    g.circle(size * 0.72, size * 0.3, size * 0.4).cut();
  },
  Arcane: (g, size) => {
    g.poly(polygonPoints(4, size / 2, size / 2, size / 2)).fill(0xffffff);
  },
  Steel: (g, size) => {
    g.poly(polygonPoints(6, size / 2, size / 2, size / 2)).fill(0xffffff);
  },
};

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

interface Placed extends Item {
  readonly x: number;
  readonly y: number;
}

/** Shelf packer. The item set is small and fixed, so nothing cleverer is needed. */
function pack(items: readonly Item[]): { placed: Placed[]; width: number; height: number } {
  const placed: Placed[] = [];
  const pad = ATLAS.padding;
  let shelfX = pad;
  let shelfY = pad;
  let shelfHeight = 0;
  let widest = 0;

  for (const item of items) {
    if (shelfX + item.width + pad > ATLAS.maxWidth && shelfHeight > 0) {
      shelfY += shelfHeight + pad;
      shelfX = pad;
      shelfHeight = 0;
    }
    placed.push({ ...item, x: shelfX, y: shelfY });
    shelfX += item.width + pad;
    shelfHeight = Math.max(shelfHeight, item.height);
    widest = Math.max(widest, shelfX);
  }

  return { placed, width: widest + pad, height: shelfY + shelfHeight + pad * 2 };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildItems(): Item[] {
  const items: Item[] = [
    { key: 'pixel', width: 4, height: 4, draw: (g, w, h) => g.rect(0, 0, w, h).fill(0xffffff) },
    { key: 'shape:1', width: ATLAS.shapeSize, height: ATLAS.shapeSize, draw: (g, w) => drawCircle(g, w) },
    { key: 'shape:2', width: ATLAS.shapeSize, height: ATLAS.shapeSize, draw: (g, w) => drawPentagon(g, w) },
    { key: 'shape:3', width: ATLAS.shapeSize, height: ATLAS.shapeSize, draw: (g, w) => drawStar(g, w) },
    { key: 'ringTrack', width: ATLAS.ringSize, height: ATLAS.ringSize, draw: (g, w) => drawRingTrack(g, w) },
    { key: 'glow', width: ATLAS.glowSize, height: ATLAS.glowSize, draw: (g, w) => drawGlow(g, w) },
    { key: 'wave', width: ATLAS.waveSize, height: ATLAS.waveSize, draw: (g, w) => drawWave(g, w) },
    { key: 'spark', width: ATLAS.sparkSize, height: ATLAS.sparkSize, draw: (g, w) => drawSpark(g, w) },
    { key: 'shard', width: ATLAS.sparkSize, height: ATLAS.sparkSize, draw: (g, w) => drawShard(g, w) },
  ];

  for (let step = 0; step < ATLAS.ringSteps; step += 1) {
    const progress = step / (ATLAS.ringSteps - 1);
    items.push({
      key: `ring:${step}`,
      width: ATLAS.ringSize,
      height: ATLAS.ringSize,
      draw: (g, w) => drawRingStep(g, w, progress),
    });
  }

  // Digits get one uniform frame each, sized to the widest and tallest of the
  // ten and with the glyph centred in it. Cropping each digit to its own ink
  // would make `1` a third the width of `8`, and a damage popup laid out from
  // those frames either overlaps the wide digits or strands the narrow ones —
  // `14` rendered as `1  4` reads as two separate numbers. A uniform box also
  // makes numbers tabular, so a health total does not jitter as it counts down.
  const glyphs = Array.from({ length: 10 }, (_, digit) => {
    const text = new Text({
      text: String(digit),
      style: {
        fill: 0xffffff,
        fontSize: ATLAS.digitSize,
        fontFamily: 'system-ui',
        fontWeight: 'bold',
      },
    });
    text.anchor.set(0.5);
    return text;
  });
  const boxWidth = Math.ceil(Math.max(...glyphs.map((text) => text.width)));
  const boxHeight = Math.ceil(Math.max(...glyphs.map((text) => text.height)));

  glyphs.forEach((text, digit) => {
    const box = new Container();
    text.position.set(boxWidth / 2, boxHeight / 2);
    box.addChild(text);
    items.push({ key: `digit:${digit}`, width: boxWidth, height: boxHeight, node: box });
  });

  for (const [tag, draw] of Object.entries(TAG_ICONS)) {
    items.push({
      key: `tag:${tag}`,
      width: ATLAS.tagIconSize,
      height: ATLAS.tagIconSize,
      draw: (g, w) => draw(g, w),
    });
  }

  return items;
}

/**
 * Draws every shape once and bakes them into a single texture.
 *
 * Called once, at boot. The `Graphics` objects exist only for the duration of
 * this call; nothing here runs again during play.
 */
export function buildAtlas(renderer: Renderer): Atlas {
  const items = buildItems();
  const { placed, width, height } = pack(items);

  const stage = new Container();
  for (const item of placed) {
    if (item.node !== undefined) {
      item.node.position.set(item.x, item.y);
      stage.addChild(item.node);
      continue;
    }
    const graphics = new Graphics();
    item.draw?.(graphics, item.width, item.height);
    graphics.position.set(item.x, item.y);
    stage.addChild(graphics);
  }

  const source = RenderTexture.create({
    width,
    height,
    resolution: ATLAS.resolution,
    antialias: true,
  });
  renderer.render({ container: stage, target: source, clear: true });
  stage.destroy({ children: true });

  const frames = new Map<string, Texture>();
  for (const item of placed) {
    frames.set(
      item.key,
      new Texture({
        source: source.source,
        frame: new Rectangle(item.x, item.y, item.width, item.height),
      }),
    );
  }

  const frame = (key: string): Texture => {
    const texture = frames.get(key);
    if (texture === undefined) throw new Error(`atlas frame ${JSON.stringify(key)} is missing`);
    return texture;
  };

  const ring: Texture[] = [];
  for (let step = 0; step < ATLAS.ringSteps; step += 1) ring.push(frame(`ring:${step}`));

  const tags: Record<string, Texture> = {};
  for (const tag of Object.keys(TAG_ICONS)) tags[tag] = frame(`tag:${tag}`);

  const digits: Texture[] = [];
  for (let digit = 0; digit <= 9; digit += 1) digits.push(frame(`digit:${digit}`));

  return {
    pixel: frame('pixel'),
    shapes: { 1: frame('shape:1'), 2: frame('shape:2'), 3: frame('shape:3') },
    ring,
    ringTrack: frame('ringTrack'),
    tags,
    glow: frame('glow'),
    wave: frame('wave'),
    spark: frame('spark'),
    shard: frame('shard'),
    digits,
    source,
    destroy(): void {
      for (const texture of frames.values()) texture.destroy(false);
      source.destroy(true);
    },
  };
}

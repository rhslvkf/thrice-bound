/**
 * Presentation constants. Values that affect gameplay balance belong in
 * `src/data`, not here — this file is strictly about how things look.
 */

import type { UnitTag } from '../data/schema';

export const RENDER = {
  /** Canvas clear colour, matching the page background in `index.html`. */
  backgroundColor: 0x0b0d13,
  /** Upper bound on `devicePixelRatio`, to protect mobile fill rate. */
  maxResolution: 2,
} as const;

/**
 * Responsive layout.
 *
 * There is no design resolution and no letterboxing. The board is fitted into
 * a safe rectangle derived from the actual viewport, so a tall phone and a
 * wide monitor each get a board sized for the space they have rather than the
 * same picture with bars glued on.
 */
export const LAYOUT = {
  /** Screen edge kept clear, as a fraction of the shorter axis. */
  safeMarginRatio: 0.045,
  /**
   * Share of the safe height the board may use, per orientation.
   *
   * Well under half, because the board is not the only thing on screen: the
   * merge and fight buttons, the card tray and the hint all live below it, and
   * on a phone they have to sit within thumb reach.
   */
  boardHeightShare: { portrait: 0.48, landscape: 0.55 },
  /** Where the board sits vertically inside the safe area, 0 = top. */
  boardVerticalAnchor: { portrait: 0.16, landscape: 0.12 },
  /** Aspect at or above which the viewport counts as landscape. */
  landscapeAspect: 1,
  /** Cell size bounds in CSS pixels, so the board is neither tiny nor absurd. */
  minCellSize: 28,
  maxCellSize: 140,
  /** Reference cell size that UI scale 1.0 corresponds to. */
  referenceCellSize: 84,
  /** Clamp on derived UI scale, so text stays legible without dominating. */
  minUiScale: 0.62,
  maxUiScale: 1.5,
} as const;

/**
 * Board geometry.
 *
 * A front view, not isometric: rows recede slightly rather than shearing. The
 * far row is narrower and the gap between far rows is smaller, which is enough
 * to read depth without giving up the straight-on readability that makes a
 * board state scannable.
 */
export const BOARD_VIEW = {
  /** Horizontal scale of the farthest row relative to the nearest. */
  farScale: 0.74,
  /**
   * How much the row spacing compresses toward the back. `0` spaces rows
   * evenly; higher values push far rows closer together.
   */
  rowCompression: 0.42,
  /** Cell height as a fraction of cell width. */
  cellAspect: 0.95,
  /** Gap between cells, as a fraction of cell size. */
  cellGap: 0.1,
  /** Corner rounding of a cell, as a fraction of cell size. */
  cellCornerRatio: 0.14,
  /** Cell outline width, as a fraction of cell size. */
  cellLineRatio: 0.02,
} as const;

export const COLORS = {
  /** Board surface, far row to near row. */
  cellFarFill: 0x141824,
  cellNearFill: 0x1b2131,
  cellLine: 0x2b3346,
  /** Tint of the rows each side deploys on. */
  playerZone: 0x1d2a3a,
  enemyZone: 0x2e1e28,
  /** Team identity. Warm gold against cold crimson reads at a glance. */
  team: { player: 0xf0c46a, enemy: 0xe0556b },
  teamDark: { player: 0x6b5526, enemy: 0x63232f },
  /** Health bar states. */
  hpHigh: 0x6fd08c,
  hpMid: 0xe0c060,
  hpLow: 0xe05a5a,
  hpTrack: 0x0d1018,
  shield: 0x7fc7e8,
  /** Cooldown ring. */
  ring: 0xffffff,
  ringTrack: 0x222a38,
  /** Feedback. */
  hitFlash: 0xffffff,
  healFlash: 0x8ff0a8,
  /** Damage popups. Crits are hotter and larger, so they read without a label. */
  damageNumber: 0xffe9c0,
  critNumber: 0xff8a4a,
  /** Merge sequence. */
  mergeFlash: 0xfff2c8,
  mergeWave: 0xf0c46a,
  /** Drag targets. */
  dropValid: 0x6fd08c,
  dropInvalid: 0xe05a5a,
  /** Cards, buttons and other furniture. */
  cardFill: 0x161c28,
  cardBorder: 0x2f394d,
  buttonFill: 0x24304a,
  buttonAccent: 0xf0c46a,
  /** Text. */
  text: 0xe8ecf4,
  textDim: 0x8b93a5,
  accent: 0xf0c46a,
} as const;

/** Tag colours, used for the small icons under a unit. */
export const TAG_COLORS: Readonly<Record<UnitTag, number>> = {
  Beast: 0x7fc98a,
  Undead: 0xa98fd0,
  Arcane: 0x6fa8f0,
  Steel: 0xc2cad8,
};

/** Sizes of a unit's parts, all as fractions of the cell size. */
export const UNIT_VIEW = {
  bodyRatio: 0.52,
  hpBarWidthRatio: 0.6,
  hpBarHeightRatio: 0.07,
  hpBarOffsetRatio: 0.3,
  shieldBarHeightRatio: 0.045,
  ringRatio: 0.66,
  tierPipRatio: 0.055,
  tierPipGapRatio: 0.03,
  tierPipOffsetRatio: 0.4,
  tagIconRatio: 0.13,
  /** Tags flank the health bar rather than stacking under it — the vertical
   *  space inside a cell is spoken for, the horizontal space is not. */
  tagIconSpreadRatio: 0.37,
  tagIconOffsetRatio: 0.3,
  /** How far a unit lunges toward its target when attacking, in cells. */
  attackLungeRatio: 0.26,
} as const;

/** Timings for purely visual motion, in milliseconds. */
export const ANIM = {
  /** How long an attack lunge takes, out and back. */
  attackMs: 160,
  /** Hit flash duration. */
  flashMs: 95,
  healFlashMs: 200,
  /** How far a hit or heal flash blends toward its colour, 0..1. */
  flashBlend: 0.72,
  /** Spawn fade-in and death fade-out. */
  spawnMs: 180,
  deathMs: 320,
  /** How fast a health bar chases its true value, in bar fractions per second. */
  hpBarSpeed: 2.6,
  /** Screen shake decay, per second. */
  shakeDecay: 5.5,
  /** Shake magnitude for a lethal blow, as a fraction of cell size. */
  shakeOnKill: 0.16,
  /** Cap so a chain of deaths cannot rattle the screen apart. */
  shakeMax: 0.36,
  /** Shake oscillation frequency, Hz. */
  shakeFrequency: 34,
} as const;

/** Replay speeds offered by the replayer. */
export const REPLAY_SPEEDS = [1, 2, 4] as const;

export const REPLAY = {
  /** Milliseconds a battle waits before the first tick plays. */
  leadInMs: 350,
  /** Milliseconds held on the final frame before the result is reported. */
  holdEndMs: 900,
  /**
   * Largest frame delta fed into the replay, in milliseconds. A backgrounded
   * tab returns one enormous delta; without this the battle would jump.
   */
  maxFrameMs: 100,
} as const;

/** Procedurally generated texture atlas. */
export const ATLAS = {
  /** Padding around each frame, to stop neighbours bleeding in when scaled. */
  padding: 2,
  /** Atlas is generated at this multiple of its nominal size, then scaled down. */
  resolution: 2,
  /** Size of a unit body shape in the atlas, in nominal pixels. */
  shapeSize: 72,
  /** Size of one cooldown-ring frame. */
  ringSize: 64,
  /** Ring stroke width, as a fraction of the frame. */
  ringThickness: 0.085,
  /**
   * Number of discrete cooldown-ring frames.
   *
   * A ring is an arc, and rebuilding an arc as `Graphics` every frame for
   * forty units would mean forty geometry rebuilds per frame. Pre-rendering
   * the sweep into frames turns it into a sprite swap, which batches. 32 steps
   * is finer than the eye tracks on a spinning ring.
   */
  ringSteps: 32,
  /** Size of a tag icon. */
  tagIconSize: 28,
  /** Size of the soft radial glow used behind units. */
  glowSize: 96,
  /** Expanding shockwave ring, and how thick its outline is. */
  waveSize: 96,
  waveThickness: 0.045,
  /** Small particle shapes. */
  sparkSize: 20,
  /** Font size digits are rasterised at. Scaled down at use, never up. */
  digitSize: 44,
  /** Maximum atlas row width before wrapping to a new shelf. */
  maxWidth: 1024,
} as const;

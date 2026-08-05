/**
 * Live-tunable feel values.
 *
 * Game feel is not something you get right by reasoning about it. You get it
 * right by moving a slider while playing and stopping when it feels good. So
 * every number that governs how a moment *lands* — as opposed to what it does
 * — lives here in a mutable store, and the dev tuning panel edits it in place
 * while the game runs.
 *
 * The split is deliberate:
 *
 * - `config.ts` holds structural constants: layout ratios, colours, atlas
 *   sizes. Changing one is a code change.
 * - This file holds timings and intensities. Changing one is a decision made
 *   with your hands, and the panel writes the result back out as JSON to paste
 *   in as the new default.
 *
 * Nothing here can affect a battle's outcome. These values reach the renderer
 * and nothing else.
 */

/** Every tunable value, grouped by the moment it belongs to. */
export interface Tuning {
  merge: {
    /** (a) Three units drawn together, ease-in. */
    convergeMs: number;
    /** How far past the meeting point they compress, as a fraction of a cell. */
    convergeOvershoot: number;
    /** (b) Everything holds still at the meeting point. */
    hitstopMs: number;
    /** How far the screen desaturates during the hold, 0..1. */
    desaturation: number;
    /** (c) The burst. */
    explosionMs: number;
    explosionParticles: number;
    explosionSpeed: number;
    explosionShake: number;
    ringWaveMs: number;
    ringWaveScale: number;
    /** (d) Upgrade choices rising into view. */
    cardRiseMs: number;
    cardStaggerMs: number;
    /** (e) The chosen unit landing. */
    landMs: number;
    landOvershoot: number;
  };
  hit: {
    /** Freeze on a normal hit and on a killing blow. */
    hitstopMs: number;
    killHitstopMs: number;
    /** White flash on the struck unit. */
    flashMs: number;
    flashBlend: number;
    /** Knockback, as a fraction of a cell. */
    knockbackRatio: number;
    knockbackMs: number;
    /** Screen shake for a kill, as a fraction of a cell. */
    killShake: number;
  };
  damageNumbers: {
    riseRatio: number;
    durationMs: number;
    fadeStart: number;
    scale: number;
    critScale: number;
    /** Horizontal spread applied to simultaneous popups, in cell fractions. */
    spreadRatio: number;
    /** Damage at or above this multiple of the attacker's normal hit is a crit. */
    critThreshold: number;
  };
  death: {
    squashMs: number;
    squashAmount: number;
    particles: number;
    particleSpeed: number;
    fadeMs: number;
  };
  synergy: {
    ringMs: number;
    ringScale: number;
    /** Delay between each affected unit's ring. */
    staggerMs: number;
  };
  drag: {
    /** How far a picked-up card lifts toward the pointer. */
    liftScale: number;
    liftMs: number;
    /** Spring back to origin after an invalid drop. */
    returnMs: number;
    /** Brightness of a legal drop target, and dimming of an illegal one. */
    validAlpha: number;
    invalidAlpha: number;
    swapMs: number;
  };
  particles: {
    gravity: number;
    drag: number;
  };
}

/** Defaults. The panel starts here and `reset` returns here. */
export const TUNING_DEFAULTS: Readonly<Tuning> = Object.freeze({
  merge: {
    convergeMs: 220,
    convergeOvershoot: 0.12,
    hitstopMs: 80,
    desaturation: 0.45,
    explosionMs: 170,
    explosionParticles: 46,
    explosionSpeed: 7.5,
    explosionShake: 0.22,
    ringWaveMs: 300,
    ringWaveScale: 3.4,
    cardRiseMs: 180,
    cardStaggerMs: 55,
    landMs: 240,
    landOvershoot: 0.25,
  },
  hit: {
    hitstopMs: 45,
    killHitstopMs: 90,
    flashMs: 95,
    flashBlend: 0.72,
    knockbackRatio: 0.09,
    knockbackMs: 130,
    killShake: 0.16,
  },
  damageNumbers: {
    riseRatio: 0.45,
    durationMs: 620,
    fadeStart: 0.55,
    scale: 0.42,
    critScale: 0.62,
    spreadRatio: 0.55,
    critThreshold: 1.5,
  },
  death: {
    squashMs: 110,
    squashAmount: 0.4,
    particles: 18,
    particleSpeed: 4.2,
    fadeMs: 220,
  },
  synergy: {
    ringMs: 420,
    ringScale: 2.2,
    staggerMs: 40,
  },
  drag: {
    liftScale: 1.14,
    liftMs: 120,
    returnMs: 420,
    validAlpha: 1,
    invalidAlpha: 0.28,
    swapMs: 180,
  },
  particles: {
    gravity: 14,
    drag: 1.8,
  },
});

/** Deep-copies the defaults into a mutable store. */
function clone(source: Readonly<Tuning>): Tuning {
  return JSON.parse(JSON.stringify(source)) as Tuning;
}

/**
 * The live values.
 *
 * Read this, not `TUNING_DEFAULTS` — the panel mutates it in place, so holding
 * a copy of a field would freeze that effect at whatever it was at startup.
 */
export const tuning: Tuning = clone(TUNING_DEFAULTS);

export type TuningGroup = keyof Tuning;

/** Range and step for one slider. */
export interface TuningField {
  readonly group: TuningGroup;
  readonly key: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly label: string;
}

const ms = (group: TuningGroup, key: string, max: number, label: string): TuningField => ({
  group,
  key,
  min: 0,
  max,
  step: 5,
  unit: 'ms',
  label,
});

const ratio = (
  group: TuningGroup,
  key: string,
  max: number,
  label: string,
  step = 0.01,
): TuningField => ({ group, key, min: 0, max, step, unit: '', label });

const count = (group: TuningGroup, key: string, max: number, label: string): TuningField => ({
  group,
  key,
  min: 0,
  max,
  step: 1,
  unit: '',
  label,
});

/**
 * What the panel shows, in the order a person would tune it: the merge
 * sequence stage by stage, then combat feel, then interaction.
 */
export const TUNING_FIELDS: readonly TuningField[] = [
  ms('merge', 'convergeMs', 600, 'a · converge'),
  ratio('merge', 'convergeOvershoot', 0.5, 'a · compress past centre'),
  ms('merge', 'hitstopMs', 300, 'b · hitstop'),
  ratio('merge', 'desaturation', 1, 'b · desaturate'),
  ms('merge', 'explosionMs', 500, 'c · explosion'),
  count('merge', 'explosionParticles', 200, 'c · particles'),
  ratio('merge', 'explosionSpeed', 20, 'c · particle speed', 0.1),
  ratio('merge', 'explosionShake', 1, 'c · shake'),
  ms('merge', 'ringWaveMs', 800, 'c · ring wave'),
  ratio('merge', 'ringWaveScale', 8, 'c · ring size', 0.1),
  ms('merge', 'cardRiseMs', 600, 'd · cards rise'),
  ms('merge', 'cardStaggerMs', 300, 'd · card stagger'),
  ms('merge', 'landMs', 600, 'e · land'),
  ratio('merge', 'landOvershoot', 1, 'e · overshoot'),

  ms('hit', 'hitstopMs', 200, 'hitstop'),
  ms('hit', 'killHitstopMs', 400, 'hitstop on kill'),
  ms('hit', 'flashMs', 400, 'flash'),
  ratio('hit', 'flashBlend', 1, 'flash strength'),
  ratio('hit', 'knockbackRatio', 0.5, 'knockback'),
  ms('hit', 'knockbackMs', 400, 'knockback time'),
  ratio('hit', 'killShake', 1, 'shake on kill'),

  ratio('damageNumbers', 'riseRatio', 2, 'rise'),
  ms('damageNumbers', 'durationMs', 2000, 'lifetime'),
  ratio('damageNumbers', 'fadeStart', 1, 'fade starts at'),
  ratio('damageNumbers', 'scale', 1, 'size'),
  ratio('damageNumbers', 'critScale', 1.5, 'crit size'),
  ratio('damageNumbers', 'spreadRatio', 1, 'spread'),
  ratio('damageNumbers', 'critThreshold', 4, 'crit threshold', 0.05),

  ms('death', 'squashMs', 400, 'squash'),
  ratio('death', 'squashAmount', 1, 'squash amount'),
  count('death', 'particles', 100, 'particles'),
  ratio('death', 'particleSpeed', 15, 'particle speed', 0.1),
  ms('death', 'fadeMs', 800, 'fade'),

  ms('synergy', 'ringMs', 1200, 'ring'),
  ratio('synergy', 'ringScale', 6, 'ring size', 0.1),
  ms('synergy', 'staggerMs', 300, 'stagger'),

  ratio('drag', 'liftScale', 2, 'lift scale'),
  ms('drag', 'liftMs', 400, 'lift'),
  ms('drag', 'returnMs', 1200, 'spring back'),
  ratio('drag', 'validAlpha', 1, 'valid cell alpha'),
  ratio('drag', 'invalidAlpha', 1, 'invalid cell alpha'),
  ms('drag', 'swapMs', 500, 'swap'),

  ratio('particles', 'gravity', 60, 'gravity', 0.5),
  ratio('particles', 'drag', 8, 'air drag', 0.05),
];

/** Reads a field from the live store. */
export function readTuning(field: TuningField): number {
  const group = tuning[field.group] as unknown as Record<string, number>;
  return group[field.key] ?? 0;
}

/** Writes a field into the live store. */
export function writeTuning(field: TuningField, value: number): void {
  const group = tuning[field.group] as unknown as Record<string, number>;
  group[field.key] = value;
}

export function resetTuning(): void {
  Object.assign(tuning, clone(TUNING_DEFAULTS));
}

/** The current values, formatted to paste back over `TUNING_DEFAULTS`. */
export function tuningToJson(): string {
  return JSON.stringify(tuning, null, 2);
}

/**
 * Budget for the merge sequence, excluding the wait for the player's choice.
 *
 * A signature moment that runs long stops being signature and starts being an
 * interruption — and this one fires several times a round. The cap is enforced
 * by a test, not by hoping.
 */
export const MERGE_SEQUENCE_BUDGET_MS = 900;

/** Sum of the merge stages that run without waiting for input. */
export function mergeSequenceMs(values: Readonly<Tuning> = tuning): number {
  const m = values.merge;
  return m.convergeMs + m.hitstopMs + m.explosionMs + m.cardRiseMs + m.landMs;
}

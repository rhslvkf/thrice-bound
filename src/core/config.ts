/**
 * Core tuning constants.
 *
 * Content numbers (unit stats, ability magnitudes) live in `src/data`. What
 * lives here is the shape of the simulation itself — the things that are not
 * per-unit content but still must not be magic numbers buried in logic.
 */

export const BATTLE = {
  /**
   * Fixed simulation step. The battle advances in whole ticks and never reads
   * a clock: the renderer draws at whatever frame rate it likes, and the
   * headless simulator runs as fast as the CPU allows. Changing this changes
   * every battle outcome.
   */
  tickMs: 50,
  /** Wall-clock length of a battle before the timeout rule decides it. */
  maxDurationMs: 60_000,
  /** Milliseconds in a second, for rate stats (`atkSpeed`, `moveSpeed`). */
  msPerSecond: 1000,
} as const;

/** Hard upper bound on simulated ticks. Guarantees termination. */
export const MAX_TICKS = Math.ceil(BATTLE.maxDurationMs / BATTLE.tickMs);

export const COMBAT = {
  /** `pure` damage bypasses shields entirely; other types are absorbed first. */
  pureIgnoresShields: true,
  /** Damage type dealt by each damage-over-time status. */
  burnDamageType: 'magical',
  poisonDamageType: 'pure',
  /** Cap on stacked `chill`, so slows can never fully immobilise a unit. */
  maxSlowFraction: 0.8,
  /** Cap on stacked `weaken`, so damage output cannot reach zero. */
  maxWeakenFraction: 0.8,
  /**
   * Floor on the combined `mult` modifier of any stat. Without it a stack of
   * negative multipliers could drive a stat to zero or below and produce
   * division by zero in the cooldown maths.
   */
  minStatMultiplier: 0.1,
  /** Floor on attack speed, for the same reason. */
  minAtkSpeed: 0.05,
} as const;

export const SYNERGY = {
  /**
   * Synergies count **distinct unit definitions**, not bodies: three Grave
   * Rats are one Undead, while a Grave Rat plus a Rot Knight plus a Crypt
   * Weaver are three. This is what makes the merge-direction choice matter —
   * merging into a dual-tag unit can add a tag you did not have.
   */
  countsDistinctUnitTypes: true,
  /** Units created mid-battle by `summon` never contribute to synergy counts. */
  summonsCount: false,
} as const;

/**
 * Run state.
 *
 * One playthrough, from the first shop to the final boss, as plain data. Every
 * field survives a JSON round-trip — no class instances, no closures, no `Map`
 * — because this is exactly what gets written to storage when the player walks
 * away mid-run and read back when they return.
 *
 * The state is **immutable from the outside**: every action in `run.ts` takes a
 * state and returns a new one. That is what lets the renderer diff two states
 * to decide what to animate, and what makes a run reproducible from a seed
 * without having to trust that nothing mutated it in passing.
 */

import type { BattleOutcome } from '../battle/index';

/**
 * Format version for saved runs.
 *
 * Bumped whenever {@link RunState} changes shape. A save from an older version
 * is discarded rather than migrated: a half-migrated run is worse than a fresh
 * one, and there is nothing here a player would mourn for more than a session.
 */
export const RUN_SAVE_VERSION = 1;

export const RUN_PHASES = [
  /** Buying, rerolling, locking. */
  'shop',
  /** Placing, swapping, merging. Same board, different verbs. */
  'prep',
  /** The fight is resolved and being replayed. No input changes it. */
  'battle',
  /** Choosing one of three relics after a win. */
  'reward',
  /** The run is finished, won or lost. */
  'over',
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/** A unit sitting on one of the player's cells. */
export interface BoardSlot {
  readonly col: number;
  readonly row: number;
  readonly unitId: string;
}

/**
 * One shop slot.
 *
 * `unitId` is `null` once bought — the slot stays, empty, until the next roll,
 * so the shop does not reflow under the player's cursor mid-purchase.
 */
export interface ShopSlot {
  readonly unitId: string | null;
  /** Survives rerolls and the round boundary. */
  readonly locked: boolean;
}

/** What happened in one round. Drives the post-run summary and the sim report. */
export interface RoundRecord {
  readonly round: number;
  readonly encounterId: string;
  readonly outcome: BattleOutcome;
  /** Ticks simulated. Multiply by `BATTLE.tickMs` for the fight's length. */
  readonly ticks: number;
  readonly enemySurvivors: number;
  readonly livesLost: number;
  readonly goldEarned: number;
  /** The relic taken after this round, or `null` if there was no reward. */
  readonly relicId: string | null;
}

export type RunResult = 'victory' | 'defeat';

export interface RunState {
  readonly saveVersion: number;
  /**
   * The run's seed.
   *
   * Everything random in a run is derived from this plus a label naming what is
   * being rolled — see `streams.ts`. Sharing a seed reproduces every shop and
   * every reward offer, which is what a daily challenge is built on.
   */
  readonly seed: number;
  /** 1-based. Never exceeds `run.rules.rounds`. */
  readonly round: number;
  readonly phase: RunPhase;
  readonly lives: number;
  readonly gold: number;
  readonly shop: readonly ShopSlot[];
  /**
   * Rerolls performed this round.
   *
   * Doubles as the shop stream's nonce, which is why it is stored rather than
   * derived: it is the only thing that distinguishes this round's third shop
   * from its first.
   */
  readonly rerolls: number;
  /** Free rerolls banked by relics. Spent before gold. */
  readonly freeRerolls: number;
  readonly board: readonly BoardSlot[];
  /** In collection order. Hook order depends on it, so it is never a set. */
  readonly relicIds: readonly string[];
  /** The three relics on offer, or `null` when no choice is pending. */
  readonly rewardOffer: readonly string[] | null;
  readonly history: readonly RoundRecord[];
  readonly result: RunResult | null;
}

/** Why an action was refused. Actions never throw for ordinary refusals — a
 *  full board or an empty purse is a normal thing for a player to attempt. */
export interface RunRefusal {
  readonly ok: false;
  readonly reason: string;
}

export interface RunSuccess {
  readonly ok: true;
  readonly state: RunState;
}

export type RunActionResult = RunSuccess | RunRefusal;

export function refuse(reason: string): RunRefusal {
  return { ok: false, reason };
}

export function accept(state: RunState): RunSuccess {
  return { ok: true, state };
}

/**
 * Team generation.
 *
 * Two kinds of matchup:
 *
 * - **Random** — both sides drawn from the roster. Broad coverage, used for
 *   per-unit and per-synergy win rates.
 * - **Merge-path pairs** — a controlled experiment. Two battles are run with
 *   an identical enemy, an identical rest-of-team and an identical battle
 *   seed, differing only in which merge option occupies one slot. Comparing
 *   those directly removes almost all the variance that a random sweep would
 *   have to average away, so a few hundred pairs say more about a merge
 *   decision than thousands of random matches.
 *
 * Everything here is seeded through the core RNG. Nothing calls
 * `Math.random`, so a report can always be reproduced from its seed.
 */

import type { BattleSetup, Deployment } from '../core/battle/index';
import { createRng, hashSeed } from '../core/rng';
import type { Rng } from '../core/rng';
import { BOARD } from '../data/schema';
import type { GameData } from '../data/schema';

/**
 * Separates the team-building stream from each battle's own stream, so
 * changing how teams are drawn never shifts combat rolls.
 */
const TEAM_SEED_SALT = 0x5f37_59df;

/** Roster ids in a fixed order, so a seed always draws the same units. */
export function rosterIds(data: GameData): string[] {
  return [...data.units.keys()].sort();
}

/**
 * Board cells for a team, filled column by column across its home rows.
 *
 * Deterministic and independent of which units are placed, so two setups that
 * differ only in unit choice put those units on the same squares.
 */
export function slotsFor(rows: readonly number[], size: number): { col: number; row: number }[] {
  const slots: { col: number; row: number }[] = [];
  for (let i = 0; i < size; i += 1) {
    slots.push({
      col: Math.floor(i / rows.length) % BOARD.cols,
      row: rows[i % rows.length] ?? 0,
    });
  }
  return slots;
}

function team(ids: readonly string[], rng: Rng, rows: readonly number[], size: number): Deployment[] {
  return slotsFor(rows, size).map((slot) => ({ unitId: rng.pick(ids), ...slot }));
}

/** A fully random matchup for a match index. */
export function randomSetup(
  data: GameData,
  seed: number,
  index: number,
  teamSize: number,
): BattleSetup {
  const battleSeed = seed + index;
  const rng = createRng(battleSeed ^ TEAM_SEED_SALT);
  const ids = rosterIds(data);
  return {
    seed: battleSeed,
    player: team(ids, rng, BOARD.playerRows, teamSize),
    enemy: team(ids, rng, BOARD.enemyRows, teamSize),
  };
}

/** One merge decision: a parent and the units it can become. */
export interface MergePair {
  readonly parentId: string;
  readonly parentName: string;
  readonly parentTier: number;
  readonly options: readonly string[];
}

/**
 * Every merge decision in the content, in a stable order.
 *
 * A unit with three or more options yields one pair entry holding all of
 * them; the study compares each option against the others.
 */
const mergePairCache = new WeakMap<GameData, MergePair[]>();

export function mergePairs(data: GameData): MergePair[] {
  const cached = mergePairCache.get(data);
  if (cached !== undefined) return cached;
  const pairs = buildMergePairs(data);
  mergePairCache.set(data, pairs);
  return pairs;
}

function buildMergePairs(data: GameData): MergePair[] {
  return [...data.units.values()]
    .filter((unit) => unit.mergesInto.length > 1)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((unit) => ({
      parentId: unit.id,
      parentName: unit.name,
      parentTier: unit.tier,
      options: unit.mergesInto,
    }));
}

/**
 * Builds the matched setups for one sample of one merge decision.
 *
 * Every returned setup shares an enemy team, a rest-of-team and a battle
 * seed; only slot 0 of the player team differs. The list is index-aligned
 * with `pair.options`.
 */
export function mergePathSetups(
  data: GameData,
  pair: MergePair,
  sampleIndex: number,
  seed: number,
  teamSize: number,
): BattleSetup[] {
  // Seeded from the parent id as well as the sample, so adding a unit to the
  // roster does not reshuffle the samples of every other merge decision.
  const battleSeed = (hashSeed(pair.parentId) + sampleIndex + seed) >>> 0;
  const rng = createRng(battleSeed ^ TEAM_SEED_SALT);
  const ids = rosterIds(data);

  const playerSlots = slotsFor(BOARD.playerRows, teamSize);
  // Drawn before the enemy so the supporting cast is identical across options.
  const support = playerSlots
    .slice(1)
    .map((slot) => ({ unitId: rng.pick(ids), ...slot }));
  const enemy = team(ids, rng, BOARD.enemyRows, teamSize);
  const studiedSlot = playerSlots[0] ?? { col: 0, row: BOARD.playerRows[0] ?? 0 };

  return pair.options.map((optionId) => ({
    seed: battleSeed,
    player: [{ unitId: optionId, ...studiedSlot }, ...support],
    enemy,
  }));
}

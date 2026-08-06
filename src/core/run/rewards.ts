/**
 * Relic rewards.
 *
 * Three relics after a win, one taken. The offer is weighted toward what the
 * board is already doing — a board of five Undead should keep seeing Undead
 * relics — because a reward that ignores the run is a reward the player
 * discards, and a run that never compounds never feels like a run.
 *
 * But only *most* of it is weighted. `rules.rewardRandomShare` of the slots are
 * drawn flat, ignoring the board entirely. That leak is the point: a fully
 * deterministic weighting turns the reward screen into a mirror, and the runs
 * people remember are the ones where an off-plan relic showed up and turned
 * into the plan. Twenty percent is enough to be a real possibility every few
 * rounds and rare enough that the intended build still arrives.
 *
 * Relic tags are read off the relic's own hooks rather than declared: a hook
 * conditioned on `tagCountAtLeast: Undead`, or one applying an effect to
 * `alliesWithTag: Undead`, *is* an Undead relic. Nothing to keep in sync.
 */

import { UNIT_TAGS } from '../../data/schema';
import type { Effect, GameData, RelicDef, UnitTag } from '../../data/schema';
import type { Rng } from '../rng';
import { tagCounts } from './board';
import { streamRng } from './streams';
import type { BoardSlot } from './types';

/** Walks nested `periodic` children so a tag buried in one still counts. */
function walkEffects(effects: readonly Effect[]): Effect[] {
  const flat: Effect[] = [];
  for (const effect of effects) {
    flat.push(effect);
    if (effect.kind === 'periodic') flat.push(...walkEffects(effect.effects));
  }
  return flat;
}

/** Every tag a relic mentions, in condition, effect target or shop odds. */
export function tagsOf(relic: RelicDef): Set<UnitTag> {
  const tags = new Set<UnitTag>();
  for (const hook of relic.hooks) {
    if (hook.condition.tag !== null) tags.add(hook.condition.tag);
    for (const action of hook.actions) {
      if (action.kind === 'shopOdds' && action.tag !== null) tags.add(action.tag);
      if (action.kind !== 'applyEffect') continue;
      for (const effect of walkEffects([action.effect])) {
        if (effect.kind === 'periodic') continue;
        if (effect.target.tag !== null) tags.add(effect.target.tag);
      }
    }
  }
  return tags;
}

/** Rarity weight for a round, or 0 if the rarity has not unlocked yet. */
function rarityWeight(data: GameData, relic: RelicDef, round: number): number {
  const entry = data.run.rarityWeights.find((row) => row.rarity === relic.rarity);
  if (entry === undefined) return 0;
  return round >= entry.minRound ? entry.weight : 0;
}

/**
 * A relic's weight for this board.
 *
 * Affinity is linear in how many matching units are deployed, so a board with
 * one Beast nudges Beast relics and a board with five leans on them hard. A
 * relic naming several tags takes the best match rather than the sum — a
 * dual-tag relic should not out-weigh a focused one just for naming more tags.
 */
export function weightOf(
  data: GameData,
  relic: RelicDef,
  round: number,
  board: readonly BoardSlot[],
): number {
  const base = rarityWeight(data, relic, round);
  if (base <= 0) return 0;

  const counts = tagCounts(data, board);
  let bestMatch = 0;
  for (const tag of tagsOf(relic)) bestMatch = Math.max(bestMatch, counts.get(tag) ?? 0);

  return base * (1 + bestMatch * data.run.rules.rewardTagAffinity);
}

function pickWeighted(rng: Rng, entries: readonly { weight: number }[]): number {
  let total = 0;
  for (const entry of entries) total += Math.max(0, entry.weight);
  if (total <= 0) return -1;

  let roll = rng.next() * total;
  for (let i = 0; i < entries.length; i += 1) {
    roll -= Math.max(0, entries[i]?.weight ?? 0);
    if (roll < 0) return i;
  }
  return entries.length - 1;
}

/**
 * Rolls the relics on offer after a win.
 *
 * Owned relics are excluded — a duplicate is not a choice. If fewer than
 * `rewardChoices` remain unowned, the offer is short rather than padded; a run
 * that has collected most of the pool is a run that earned a smaller menu.
 */
export function rollRewards(
  data: GameData,
  seed: number,
  round: number,
  board: readonly BoardSlot[],
  owned: readonly string[],
): string[] {
  const rng = streamRng(seed, { kind: 'reward', round });
  const ownedIds = new Set(owned);

  // Id order, so the candidate list does not depend on Map insertion order.
  const candidates = [...data.relics.values()]
    .filter((relic) => !ownedIds.has(relic.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const offer: string[] = [];
  const taken = new Set<string>();
  const wanted = Math.min(data.run.rules.rewardChoices, candidates.length);

  while (offer.length < wanted) {
    const pool = candidates.filter((relic) => !taken.has(relic.id));
    if (pool.length === 0) break;

    // The coin is flipped for every slot, whether or not the weighted draw
    // would have succeeded, so the number of RNG calls does not depend on the
    // board. Same seed, same sequence.
    const unweighted = rng.nextBool(data.run.rules.rewardRandomShare);

    const entries = pool.map((relic) => ({
      relic,
      weight: unweighted
        ? // Flat, but still respecting the rarity unlock schedule: a legendary
          // in round 1 is not a surprise, it is a bug.
          rarityWeight(data, relic, round) > 0
          ? 1
          : 0
        : weightOf(data, relic, round, board),
    }));

    let index = pickWeighted(rng, entries);
    if (index < 0) {
      // Nothing has unlocked at this round. Fall back to the lowest rarity
      // available rather than offering nothing at all.
      index = pickWeighted(
        rng,
        pool.map((relic) => ({ weight: rarityWeight(data, relic, 1) > 0 ? 1 : 0 })),
      );
    }
    if (index < 0) break;

    const chosen = pool[index];
    if (chosen === undefined) break;
    taken.add(chosen.id);
    offer.push(chosen.id);
  }

  return offer;
}

/** Exposed for the sim report: how the roster splits across tags. */
export function relicTagIndex(data: GameData): Map<UnitTag, string[]> {
  const index = new Map<UnitTag, string[]>();
  for (const tag of UNIT_TAGS) index.set(tag, []);
  for (const relic of [...data.relics.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const tag of tagsOf(relic)) index.get(tag)?.push(relic.id);
  }
  return index;
}

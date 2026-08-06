/**
 * The shop.
 *
 * Rolls `rules.shopSlots` units per round. Which tiers can appear, and how
 * often, comes from `run.json` — one weight row per round, so the curve is a
 * data edit rather than a code change.
 *
 * Two things are rolled, in this order, and the order is load-bearing for
 * reproducibility: first a tier, then a unit within it. Rolling a unit directly
 * from a flat weighted list would make the tier curve implicit and would shift
 * every subsequent roll whenever a unit was added to the roster.
 *
 * Relics bend the odds through `shopOdds` actions. Those are read off hooks
 * that fire `onRoundStart` — the shop is rolled at round start, and a reroll is
 * still that round's shop, so a relic's odds apply to both without needing a
 * trigger of its own.
 */

import type { GameData, RelicDef, UnitDef, UnitTag } from '../../data/schema';
import type { Rng } from '../rng';
import { streamRng } from './streams';
import type { ShopSlot } from './types';

/** Weight multipliers a relic applies to a tag, collected before a roll. */
export type ShopOddsModifiers = ReadonlyMap<UnitTag, number>;

/**
 * Reads the `shopOdds` actions off the player's relics.
 *
 * Conditions are not evaluated here: the only conditions that make sense on a
 * shop-odds relic are round- and gold-based, and the caller is the one holding
 * those. `run.ts` filters before calling.
 */
export function shopOddsFrom(relics: readonly RelicDef[]): Map<UnitTag, number> {
  const modifiers = new Map<UnitTag, number>();
  for (const relic of relics) {
    for (const hook of relic.hooks) {
      for (const action of hook.actions) {
        if (action.kind !== 'shopOdds') continue;
        if (action.tag === null) continue;
        modifiers.set(action.tag, (modifiers.get(action.tag) ?? 1) * action.weightMult);
      }
    }
  }
  return modifiers;
}

/** The tier weights for a round, falling back to the last row past the end. */
export function tierWeightsFor(data: GameData, round: number): [number, number, number] {
  const rows = data.run.shopTierOdds;
  const exact = rows.find((row) => row.round === round);
  const row = exact ?? rows[rows.length - 1];
  if (row === undefined) throw new Error('run.shopTierOdds is empty');
  return [row.tier1, row.tier2, row.tier3];
}

/** Picks an index by weight. Assumes at least one weight is positive. */
function pickWeighted(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const weight of weights) total += Math.max(0, weight);
  if (total <= 0) return 0;

  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= Math.max(0, weights[i] ?? 0);
    if (roll < 0) return i;
  }
  // Floating-point slack at the very top of the range.
  return weights.length - 1;
}

/** Units of a tier, in id order so the pool does not depend on Map insertion. */
function poolForTier(data: GameData, tier: number): UnitDef[] {
  return [...data.units.values()]
    .filter((unit) => unit.tier === tier)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A unit's weight after relic modifiers. Tags multiply, so a dual-tag unit
 *  boosted on both tags is boosted twice — which is the intent. */
function unitWeight(unit: UnitDef, modifiers: ShopOddsModifiers): number {
  let weight = 1;
  for (const tag of unit.tags) weight *= modifiers.get(tag) ?? 1;
  return weight;
}

/** Rolls one slot: a tier by the round's curve, then a unit within that tier. */
export function rollSlot(
  data: GameData,
  rng: Rng,
  round: number,
  modifiers: ShopOddsModifiers,
): string {
  const weights = tierWeightsFor(data, round);
  const tier = pickWeighted(rng, weights) + 1;

  const pool = poolForTier(data, tier);
  if (pool.length === 0) {
    // A weight row naming a tier with no units is a content bug, but refusing
    // to roll would strand the run; tier 1 always has a pool.
    const fallback = poolForTier(data, 1);
    const first = fallback[0];
    if (first === undefined) throw new Error('no tier 1 units to stock the shop with');
    return rng.pick(fallback).id;
  }

  const index = pickWeighted(
    rng,
    pool.map((unit) => unitWeight(unit, modifiers)),
  );
  const chosen = pool[index] ?? pool[0];
  if (chosen === undefined) throw new Error('weighted pick fell off the pool');
  return chosen.id;
}

/**
 * Rolls a full shop.
 *
 * Locked slots keep their contents and are not re-rolled — but the roll for
 * them still happens and is discarded, so locking does not shift what the
 * *other* slots would have shown. Two players on the same seed see the same
 * shop whether or not one of them locked slot 3.
 */
export function rollShop(
  data: GameData,
  seed: number,
  round: number,
  roll: number,
  previous: readonly ShopSlot[],
  modifiers: ShopOddsModifiers,
): ShopSlot[] {
  const rng = streamRng(seed, { kind: 'shop', round, roll });
  const slots: ShopSlot[] = [];

  for (let i = 0; i < data.run.rules.shopSlots; i += 1) {
    const rolled = rollSlot(data, rng, round, modifiers);
    const held = previous[i];
    if (held !== undefined && held.locked && held.unitId !== null) {
      slots.push(held);
      continue;
    }
    slots.push({ unitId: rolled, locked: false });
  }

  return slots;
}

/** Price of a shop slot. Tier is priced in the unit definition, not here. */
export function priceOf(data: GameData, unitId: string): number {
  return data.units.get(unitId)?.cost ?? 0;
}

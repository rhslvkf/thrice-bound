/**
 * Relics, outside a battle.
 *
 * The other half of `src/core/battle/relics.ts`: gold, rerolls, granted units
 * and shop odds. Nothing here touches a fight, and nothing in that file touches
 * a purse.
 *
 * Run hooks are deterministic without consuming randomness — `chance` is
 * rolled against a stream derived from the seed and the trigger, so a relic
 * that procs 25% of the time on `onRoundStart` procs on exactly the same rounds
 * for a given seed. That is what keeps a shared seed honest when a relic is
 * involved.
 */

import type { GameData, RelicDef, RelicHook, RelicTrigger } from '../../data/schema';
import { hashSeed } from '../rng';
import { createRng } from '../rng';
import { firstFreeCell, place, tagCounts } from './board';
import type { BoardSlot } from './types';

/** The run-side outcome of firing a set of hooks. */
export interface RunHookOutcome {
  readonly gold: number;
  readonly freeRerolls: number;
  readonly board: readonly BoardSlot[];
  /** Units a `grantUnit` action could not place, because the board was full. */
  readonly unplaced: readonly string[];
}

/** What a hook's condition is evaluated against. */
export interface RunHookContext {
  readonly round: number;
  readonly gold: number;
  readonly board: readonly BoardSlot[];
}

export function relicsOf(data: GameData, ids: readonly string[]): RelicDef[] {
  const defs: RelicDef[] = [];
  for (const id of ids) {
    const relic = data.relics.get(id);
    if (relic !== undefined) defs.push(relic);
  }
  return defs;
}

export function conditionHolds(
  data: GameData,
  hook: RelicHook,
  ctx: RunHookContext,
): boolean {
  const { condition } = hook;
  switch (condition.kind) {
    case 'always':
      return true;
    case 'roundAtLeast':
      return condition.value !== null && ctx.round >= condition.value;
    case 'goldAtMost':
      return condition.value !== null && ctx.gold <= condition.value;
    case 'tagCountAtLeast':
      if (condition.tag === null || condition.value === null) return false;
      return (tagCounts(data, ctx.board).get(condition.tag) ?? 0) >= condition.value;
  }
}

/**
 * Fires every hook on the given trigger.
 *
 * `applyEffect` actions are skipped: they only mean something inside a battle,
 * and the content loader already refuses to pair them with a run trigger.
 */
export function fireRunHooks(
  data: GameData,
  seed: number,
  trigger: RelicTrigger,
  relicIds: readonly string[],
  ctx: RunHookContext,
): RunHookOutcome {
  // One stream per (seed, trigger, round): the same round always rolls the same
  // procs, and a proc on `onMerge` cannot shift what `onRoundStart` rolls.
  const rng = createRng(hashSeed(`${seed >>> 0}/relic:${trigger}:${ctx.round}`));

  let gold = 0;
  let freeRerolls = 0;
  let board: readonly BoardSlot[] = ctx.board;
  const unplaced: string[] = [];

  for (const relic of relicsOf(data, relicIds)) {
    for (const hook of relic.hooks) {
      if (hook.on !== trigger) continue;
      // Condition is checked against the *incoming* gold, not the running
      // total, so two Merchant's Ledgers both see the round's opening purse
      // rather than the second one seeing the first one's payout.
      if (!conditionHolds(data, hook, ctx)) continue;
      if (hook.chance < 1 && !rng.nextBool(hook.chance)) continue;

      for (const action of hook.actions) {
        switch (action.kind) {
          case 'grantGold':
            gold += action.amount;
            break;
          case 'grantReroll':
            freeRerolls += action.amount;
            break;
          case 'grantUnit':
            for (let i = 0; i < action.count; i += 1) {
              const cell = firstFreeCell(board);
              if (cell === null) {
                unplaced.push(action.unitId);
                continue;
              }
              board = place(board, cell.col, cell.row, action.unitId);
            }
            break;
          case 'shopOdds':
            // Read by `shop.ts` at roll time, not applied as a delta here.
            break;
          case 'applyEffect':
            break;
        }
      }
    }
  }

  return { gold, freeRerolls, board, unplaced };
}

/**
 * Relics whose `shopOdds` actions currently apply.
 *
 * Filtered by condition here so `shop.ts` never has to know what run state is.
 */
export function activeShopOddsRelics(
  data: GameData,
  relicIds: readonly string[],
  ctx: RunHookContext,
): RelicDef[] {
  return relicsOf(data, relicIds).filter((relic) =>
    relic.hooks.some(
      (hook) =>
        hook.actions.some((action) => action.kind === 'shopOdds') &&
        conditionHolds(data, hook, ctx),
    ),
  );
}

/**
 * Unit creation.
 *
 * Kept separate from `setup.ts` so that `effects.ts` can summon units without
 * importing the battle bootstrap, which in turn imports abilities, which
 * imports effects. Spawning queues an `onSpawn` trigger rather than firing the
 * ability directly, for the same reason.
 */

import type { GameData, UnitDef } from '../../data/schema';
import type { BattleContext } from './context';
import { emit } from './context';
import type { BattleUnit, Team } from './types';

/** Builds a battle unit from a definition. Does not place it in the battle. */
export function createUnit(
  def: UnitDef,
  instanceId: number,
  team: Team,
  col: number,
  row: number,
  summoned: boolean,
): BattleUnit {
  return {
    instanceId,
    defId: def.id,
    team,
    tags: def.tags,
    abilityId: def.abilityId,
    summoned,
    col,
    row,
    hp: def.stats.hp,
    maxHp: def.stats.hp,
    shields: [],
    alive: true,
    baseStats: def.stats,
    mods: [],
    statuses: [],
    // Zero, so a unit attacks on the first tick it is in range rather than
    // standing through a wind-up it never asked for.
    attackCooldownMs: 0,
    moveCooldownMs: 0,
    abilityElapsedMs: 0,
    abilityCooldownMs: 0,
    targetId: null,
  };
}

export function lookupUnit(data: GameData, defId: string): UnitDef {
  const def = data.units.get(defId);
  if (def === undefined) {
    throw new Error(`unknown unit definition ${JSON.stringify(defId)}`);
  }
  return def;
}

/**
 * Adds a unit to the battle, emits its `spawn` event, and queues `onSpawn`.
 *
 * Instance ids are handed out in spawn order and never reused, which is what
 * makes them a safe deterministic tie-breaker everywhere else.
 */
export function spawnUnit(
  ctx: BattleContext,
  defId: string,
  team: Team,
  col: number,
  row: number,
  summoned: boolean,
): BattleUnit {
  const def = lookupUnit(ctx.data, defId);
  const unit = createUnit(def, ctx.nextInstanceId, team, col, row, summoned);
  ctx.nextInstanceId += 1;
  ctx.units.push(unit);

  emit(ctx, {
    kind: 'spawn',
    instanceId: unit.instanceId,
    defId: unit.defId,
    team: unit.team,
    col: unit.col,
    row: unit.row,
    hp: unit.hp,
    maxHp: unit.maxHp,
    summoned: unit.summoned,
  });

  ctx.pendingTriggers.push({ kind: 'onSpawn', unitId: unit.instanceId });
  return unit;
}

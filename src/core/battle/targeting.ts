/**
 * Target selection.
 *
 * Two jobs, kept together because they share the same ordering rules:
 *
 * - **Combat targeting** — which enemy a unit walks toward and attacks.
 * - **Effect targeting** — resolving a `TargetSelector` from content into a
 *   concrete list of units.
 *
 * Every selection is deterministic. Where several candidates tie, the lower
 * `instanceId` wins; only `randomEnemy` consults the RNG, and it does so
 * through the injected seeded generator.
 */

import type { TargetSelector } from '../../data/schema';
import type { BattleContext } from './context';
import { living, livingById, livingOf, unitById } from './context';
import { distance } from './grid';
import type { BattleUnit, EffectContext, Team } from './types';
import { opposing } from './types';

/** Orders by distance from a unit, then by instance id. */
function byProximityTo(origin: BattleUnit) {
  return (a: BattleUnit, b: BattleUnit): number => {
    const byDistance = distance(origin, a) - distance(origin, b);
    if (byDistance !== 0) return byDistance;
    return a.instanceId - b.instanceId;
  };
}

/** The closest living enemy, or `null` if that team is wiped out. */
export function nearestEnemy(ctx: BattleContext, unit: BattleUnit): BattleUnit | null {
  const enemies = livingOf(ctx, opposing(unit.team));
  if (enemies.length === 0) return null;
  return enemies.sort(byProximityTo(unit))[0] ?? null;
}

/**
 * Returns the unit's target, acquiring a new one if needed.
 *
 * A target is kept while it lives. Re-picking the nearest enemy every tick
 * would make units oscillate between two equidistant foes and would flood the
 * event log with target changes; committing until the target dies is both
 * calmer to watch and cheaper to simulate.
 */
export function acquireTarget(
  ctx: BattleContext,
  unit: BattleUnit,
): BattleUnit | null {
  const current = livingById(ctx, unit.targetId);
  if (current !== null) return current;

  const next = nearestEnemy(ctx, unit);
  unit.targetId = next?.instanceId ?? null;
  return next;
}

function alliesOf(ctx: BattleContext, team: Team): BattleUnit[] {
  return livingOf(ctx, team);
}

/**
 * Resolves a content `TargetSelector` against the current battle.
 *
 * Returns living units only — an effect never lands on a corpse, including
 * when the intended target died earlier in the same tick.
 */
export function resolveTargets(
  ctx: BattleContext,
  selector: TargetSelector,
  effectCtx: EffectContext,
): BattleUnit[] {
  const source = unitById(ctx, effectCtx.sourceId);
  if (source === null) return [];
  const enemyTeam = opposing(source.team);

  switch (selector.mode) {
    case 'self':
      // Returned even when dead, so an `onDeath` ability can still use the
      // corpse as an anchor — that is how `raise_wisp` places its summon.
      // Effects that make no sense on a corpse are filtered in `applyEffect`.
      return [source];

    case 'eventSource': {
      const target = livingById(ctx, effectCtx.eventSourceId);
      return target === null ? [] : [target];
    }

    case 'attackTarget': {
      const target = livingById(ctx, effectCtx.attackTargetId);
      return target === null ? [] : [target];
    }

    case 'nearestEnemy':
      return livingOf(ctx, enemyTeam)
        .sort(byProximityTo(source))
        .slice(0, selector.count ?? 1);

    case 'randomEnemy':
      // The only RNG use in targeting. Sorting by id first makes the input to
      // the shuffle order-independent, so the draw depends on the seed alone.
      return ctx.rng
        .shuffle(
          livingOf(ctx, enemyTeam).sort((a, b) => a.instanceId - b.instanceId),
        )
        .slice(0, selector.count ?? 1);

    case 'lowestHpAlly':
      return alliesOf(ctx, source.team)
        .sort((a, b) => {
          const byHp = a.hp - b.hp;
          return byHp !== 0 ? byHp : a.instanceId - b.instanceId;
        })
        .slice(0, selector.count ?? 1);

    case 'allEnemies':
      return livingOf(ctx, enemyTeam);

    case 'allAllies':
      return alliesOf(ctx, source.team);

    case 'enemiesInRadius':
      return livingOf(ctx, enemyTeam).filter(
        (unit) => distance(source, unit) <= (selector.radius ?? 0),
      );

    case 'alliesInRadius':
      return alliesOf(ctx, source.team).filter(
        (unit) => distance(source, unit) <= (selector.radius ?? 0),
      );

    case 'alliesWithTag':
      return alliesOf(ctx, source.team).filter(
        (unit) => selector.tag !== null && unit.tags.includes(selector.tag),
      );

    default:
      return [];
  }
}

/** Every living unit, ordered by instance id. The canonical turn order. */
export function turnOrder(ctx: BattleContext): BattleUnit[] {
  return living(ctx).sort((a, b) => a.instanceId - b.instanceId);
}

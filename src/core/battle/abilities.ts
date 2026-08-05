/**
 * Ability triggering.
 *
 * An ability fires when its trigger occurs, subject to two gates: a `chance`
 * roll against the injected RNG, and a `cooldownMs` since its last proc. Both
 * are content-driven; this file only decides *when* the trigger happened.
 *
 * Reaction triggers (`onSpawn`, `onHit`, `onDeath`, `onAllyDeath`) are queued
 * during the tick and drained once at the end of it. That keeps a chain of
 * reactions from recursing through the middle of another unit's turn and gives
 * every proc a stable position in the event log.
 */

import type { AbilityDef, AbilityTrigger } from '../../data/schema';
import type { BattleContext } from './context';
import { unitById } from './context';
import { applyEffects } from './effects';
import { turnOrder } from './targeting';
import type { BattleUnit, EffectContext } from './types';

function abilityOf(ctx: BattleContext, unit: BattleUnit): AbilityDef | null {
  if (unit.abilityId === null) return null;
  return ctx.data.abilities.get(unit.abilityId) ?? null;
}

/**
 * Fires a unit's ability if its trigger matches and both gates pass.
 *
 * Returns `true` if it actually went off. The RNG is only consulted for
 * abilities whose `chance` is below 1, so adding a guaranteed ability to a
 * unit never shifts the random stream for anything else.
 */
export function tryTrigger(
  ctx: BattleContext,
  unit: BattleUnit,
  trigger: AbilityTrigger,
  effectCtx: EffectContext,
): boolean {
  if (!unit.alive) return false;
  const ability = abilityOf(ctx, unit);
  if (ability === null || ability.trigger !== trigger) return false;
  if (unit.abilityCooldownMs > 0) return false;
  if (ability.chance < 1 && !ctx.rng.nextBool(ability.chance)) return false;

  fire(ctx, unit, ability, effectCtx);
  return true;
}

function fire(
  ctx: BattleContext,
  unit: BattleUnit,
  ability: AbilityDef,
  effectCtx: EffectContext,
): void {
  unit.abilityCooldownMs = ability.cooldownMs ?? 0;

  // The list of units an ability touched is only known once its effects have
  // run, but the log must read cause-then-consequence so the renderer can
  // start a cast animation before the damage lands. So: remember where the
  // ability event belongs, run the effects, then insert it ahead of them.
  const insertAt = ctx.events.length;
  const touched = applyEffects(ctx, ability.effects, effectCtx);

  ctx.events.splice(insertAt, 0, {
    kind: 'ability',
    tick: ctx.tick,
    instanceId: unit.instanceId,
    abilityId: ability.id,
    trigger: ability.trigger,
    targetIds: touched.map((target) => target.instanceId),
  });
}

/** A context for a trigger that has no attacker and no attack target. */
function selfContext(unit: BattleUnit): EffectContext {
  return { sourceId: unit.instanceId, eventSourceId: null, attackTargetId: null };
}

/**
 * Advances `interval` abilities and fires the ones that came due.
 *
 * The accumulator carries the remainder across ticks, so an ability on a
 * 3000ms interval fires every 60 ticks exactly rather than drifting.
 */
export function tickIntervalAbilities(ctx: BattleContext, elapsedMs: number): void {
  for (const unit of turnOrder(ctx)) {
    const ability = abilityOf(ctx, unit);
    if (ability === null || ability.trigger !== 'interval') continue;
    if (ability.intervalMs === null) continue;

    unit.abilityElapsedMs += elapsedMs;
    if (unit.abilityElapsedMs < ability.intervalMs) continue;
    unit.abilityElapsedMs -= ability.intervalMs;

    tryTrigger(ctx, unit, 'interval', selfContext(unit));
  }
}

/**
 * Resolves every queued reaction trigger.
 *
 * Draining is iterative rather than recursive, and bounded: a death ability
 * that kills someone else queues more triggers, which are picked up by the
 * same loop until the queue empties.
 */
export function drainTriggers(ctx: BattleContext): void {
  // Guards against content that could otherwise ping-pong death reactions
  // forever. Twenty units means each can die once, so this is generous.
  const maxPasses = 64;
  let passes = 0;

  while (ctx.pendingTriggers.length > 0 && passes < maxPasses) {
    passes += 1;
    const batch = ctx.pendingTriggers.splice(0, ctx.pendingTriggers.length);

    for (const pending of batch) {
      const unit = unitById(ctx, pending.unitId);
      if (unit === null) continue;

      switch (pending.kind) {
        case 'onSpawn':
          tryTrigger(ctx, unit, 'onSpawn', selfContext(unit));
          break;

        case 'onHit':
          tryTrigger(ctx, unit, 'onHit', {
            sourceId: unit.instanceId,
            eventSourceId: pending.sourceId,
            attackTargetId: unit.targetId,
          });
          break;

        case 'onDeath':
          // A dying unit's ability still fires; `tryTrigger` would refuse it
          // because the unit is no longer alive, so it is dispatched directly.
          fireDeathAbility(ctx, unit, pending.killerId);
          break;

        case 'onAllyDeath':
          tryTrigger(ctx, unit, 'onAllyDeath', {
            sourceId: unit.instanceId,
            eventSourceId: pending.deadAllyId,
            attackTargetId: unit.targetId,
          });
          break;
      }
    }
  }

  // If content ever does loop, drop the remainder rather than hang the tick.
  ctx.pendingTriggers.length = 0;
}

/**
 * Fires an `onDeath` ability for a unit that is already dead.
 *
 * Effects that target `self` will find nothing — the unit is not alive — which
 * is why `raise_wisp` summons relative to the corpse rather than healing it.
 */
function fireDeathAbility(
  ctx: BattleContext,
  unit: BattleUnit,
  killerId: number | null,
): void {
  const ability = abilityOf(ctx, unit);
  if (ability === null || ability.trigger !== 'onDeath') return;
  if (ability.chance < 1 && !ctx.rng.nextBool(ability.chance)) return;

  fire(ctx, unit, ability, {
    sourceId: unit.instanceId,
    eventSourceId: killerId,
    attackTargetId: null,
  });
}

/** Ages ability cooldowns by one tick. */
export function tickAbilityCooldowns(ctx: BattleContext, elapsedMs: number): void {
  for (const unit of ctx.units) {
    if (unit.abilityCooldownMs > 0) {
      unit.abilityCooldownMs = Math.max(0, unit.abilityCooldownMs - elapsedMs);
    }
  }
}

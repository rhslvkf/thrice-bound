/**
 * Damage and healing application.
 *
 * Everything that reduces or restores HP goes through this file, so the whole
 * mitigation pipeline is readable in one place:
 *
 *   raw amount -> attacker's `weaken` -> shield absorption -> HP
 *
 * `pure` damage skips the shield step (see `COMBAT.pureIgnoresShields`).
 * There are no armour or resistance stats yet; when they arrive, this is the
 * only file that changes.
 */

import { BATTLE, COMBAT } from '../config';
import type { BattleContext } from './context';
import { emit, unitById } from './context';
// Cyclic with `effects.ts` -> `damage.ts`: relic hooks apply effects, and
// effects deal damage. Every export involved is a hoisted function
// declaration, so both halves are defined by the time either is called.
import { applyDamagedRelics, applyDeathRelics } from './relics';
import {
  absorbWithShields,
  effectiveStat,
  pushShield,
  totalShield,
  weakenFraction,
} from './stats';
import type { BattleUnit, DamageInput } from './types';

export interface DamageResult {
  /** HP actually removed. */
  readonly applied: number;
  /** Damage swallowed by the shield instead of HP. */
  readonly absorbed: number;
  /** `true` if this blow is what killed the target. */
  readonly lethal: boolean;
}

/** Base damage of an ordinary attack: the attacker's current attack stat. */
export function attackDamage(attacker: BattleUnit): number {
  return effectiveStat(attacker, 'atk');
}

/**
 * Scales a raw amount by the source's `weaken`.
 *
 * Applied on the way out rather than on the way in, so weakening a unit
 * reduces everything it deals, including its abilities.
 */
export function outgoingDamage(source: BattleUnit | null, amount: number): number {
  if (source === null) return amount;
  return amount * (1 - weakenFraction(source));
}

/**
 * Applies damage to a unit, emitting the event and, if it kills, the death.
 *
 * Death is settled immediately — the unit stops being a valid target within
 * the same tick — but the `onDeath` and `onAllyDeath` reactions are queued
 * rather than run, so a chain of death abilities cannot recurse through the
 * middle of another unit's turn.
 */
export function dealDamage(
  ctx: BattleContext,
  target: BattleUnit,
  input: DamageInput,
  sourceId: number | null,
): DamageResult {
  if (!target.alive || input.amount <= 0) {
    return { applied: 0, absorbed: 0, lethal: false };
  }

  const bypassesShield = COMBAT.pureIgnoresShields && input.damageType === 'pure';
  const absorbed = bypassesShield ? 0 : absorbWithShields(target, input.amount);
  const remaining = input.amount - absorbed;

  const applied = Math.min(target.hp, remaining);
  target.hp -= applied;
  const lethal = target.hp <= 0;

  emit(ctx, {
    kind: 'damage',
    sourceId,
    targetId: target.instanceId,
    amount: applied,
    absorbed,
    damageType: input.damageType,
    source: input.source,
    hpAfter: target.hp,
    shieldAfter: totalShield(target),
    lethal,
  });

  // An ordinary attack is what `onHit` reacts to. Damage-over-time is
  // excluded: a burn ticking every 50ms would otherwise proc a retaliation
  // ability twenty times a second.
  if (input.source === 'attack' && target.alive && !lethal) {
    ctx.pendingTriggers.push({
      kind: 'onHit',
      unitId: target.instanceId,
      sourceId,
    });
    // Relic reactions run inline rather than queued: their effects are small
    // and self-contained, and a retaliation that lands a tick late would read
    // as belonging to the wrong hit in the event log.
    applyDamagedRelics(ctx, target, sourceId);
  }

  if (lethal) kill(ctx, target, sourceId);
  return { applied, absorbed, lethal };
}

/** Marks a unit dead, emits the event, and queues the death reactions. */
export function kill(
  ctx: BattleContext,
  target: BattleUnit,
  killerId: number | null,
): void {
  if (!target.alive) return;
  target.alive = false;
  target.hp = 0;
  target.shields = [];
  target.targetId = null;

  emit(ctx, { kind: 'death', instanceId: target.instanceId, killerId });

  applyDeathRelics(ctx, target, killerId);

  ctx.pendingTriggers.push({
    kind: 'onDeath',
    unitId: target.instanceId,
    killerId,
  });
  for (const ally of ctx.units) {
    if (ally.alive && ally.team === target.team && ally.instanceId !== target.instanceId) {
      ctx.pendingTriggers.push({
        kind: 'onAllyDeath',
        unitId: ally.instanceId,
        deadAllyId: target.instanceId,
      });
    }
  }

  // Anyone aiming at the corpse re-acquires next tick.
  for (const unit of ctx.units) {
    if (unit.targetId === target.instanceId) unit.targetId = null;
  }
}

/** Restores HP, capped at maximum, and emits the event if anything landed. */
export function heal(
  ctx: BattleContext,
  target: BattleUnit,
  amount: number,
  sourceId: number | null,
): number {
  if (!target.alive || amount <= 0) return 0;
  const applied = Math.min(amount, target.maxHp - target.hp);
  if (applied <= 0) return 0;

  target.hp += applied;
  emit(ctx, {
    kind: 'heal',
    sourceId,
    targetId: target.instanceId,
    amount: applied,
    hpAfter: target.hp,
  });
  return applied;
}

/**
 * Adds to a unit's shield pool. Shields stack, each with its own lifetime.
 *
 * `durationMs === null` lasts until the shield is broken or the battle ends.
 */
export function addShield(
  ctx: BattleContext,
  target: BattleUnit,
  amount: number,
  durationMs: number | null,
  sourceId: number | null,
): void {
  if (!target.alive || amount <= 0) return;
  pushShield(target, { amount, remainingMs: durationMs });
  emit(ctx, {
    kind: 'shield',
    sourceId,
    targetId: target.instanceId,
    amount,
    shieldAfter: totalShield(target),
  });
}

/** Resolves an ordinary attack from one unit to another. */
export function performAttack(
  ctx: BattleContext,
  attacker: BattleUnit,
  target: BattleUnit,
): DamageResult {
  emit(ctx, {
    kind: 'attack',
    instanceId: attacker.instanceId,
    targetId: target.instanceId,
    col: attacker.col,
    row: attacker.row,
    targetCol: target.col,
    targetRow: target.row,
  });

  return dealDamage(
    ctx,
    target,
    {
      amount: outgoingDamage(attacker, attackDamage(attacker)),
      damageType: 'physical',
      source: 'attack',
    },
    attacker.instanceId,
  );
}

/** Applies one tick of every damage-over-time status on a unit. */
export function applyDamageOverTime(
  ctx: BattleContext,
  unit: BattleUnit,
  elapsedMs: number,
): void {
  for (const status of unit.statuses) {
    if (!unit.alive) return;
    const damageType =
      status.status === 'burn'
        ? COMBAT.burnDamageType
        : status.status === 'poison'
          ? COMBAT.poisonDamageType
          : null;
    if (damageType === null) continue;

    // `magnitude` is damage per second; scale it to the tick.
    const amount = outgoingDamage(
      unitById(ctx, status.sourceId),
      status.magnitude * (elapsedMs / BATTLE.msPerSecond),
    );
    dealDamage(ctx, unit, { amount, damageType, source: 'status' }, status.sourceId);
  }
}

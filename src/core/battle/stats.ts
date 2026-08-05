/**
 * Effective stats: base values combined with modifiers and statuses.
 *
 * Every stat read during a battle goes through here, so a balance change to
 * how modifiers stack is a change to one file. Modifiers combine as
 * `(base + sum of adds) * (1 + sum of mults)`, which means two +50% buffs give
 * +100%, not +125%.
 */

import type { StatKey } from '../../data/schema';
import { BATTLE, COMBAT } from '../config';
import type { ActiveMod, BattleUnit, ShieldEntry } from './types';

/** Base plus modifiers, before status effects. */
function modifiedStat(unit: BattleUnit, key: StatKey): number {
  let add = 0;
  let mult = 0;
  for (const mod of unit.mods) {
    if (mod.stat !== key) continue;
    if (mod.op === 'add') add += mod.amount;
    else mult += mod.amount;
  }
  const scale = Math.max(COMBAT.minStatMultiplier, 1 + mult);
  return Math.max(0, (unit.baseStats[key] + add) * scale);
}

/** Total absorption remaining across every shield on a unit. */
export function totalShield(unit: BattleUnit): number {
  return unit.shields.reduce((sum, entry) => sum + entry.amount, 0);
}

/**
 * Drains `amount` from the shield pool and returns what it absorbed.
 *
 * Soonest-to-expire first, so a temporary shield is spent before a permanent
 * one rather than expiring unused. Ties break on insertion order, which keeps
 * the drain deterministic.
 */
export function absorbWithShields(unit: BattleUnit, amount: number): number {
  const order = unit.shields
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aMs = a.entry.remainingMs ?? Number.POSITIVE_INFINITY;
      const bMs = b.entry.remainingMs ?? Number.POSITIVE_INFINITY;
      return aMs !== bMs ? aMs - bMs : a.index - b.index;
    });

  let remaining = amount;
  for (const { entry } of order) {
    if (remaining <= 0) break;
    const taken = Math.min(entry.amount, remaining);
    entry.amount -= taken;
    remaining -= taken;
  }
  unit.shields = unit.shields.filter((entry) => entry.amount > 0);
  return amount - remaining;
}

/** Adds a shield entry to the pool. */
export function pushShield(unit: BattleUnit, entry: ShieldEntry): void {
  unit.shields.push(entry);
}

/** Total `chill` slow, capped so a unit can never be frozen solid. */
export function slowFraction(unit: BattleUnit): number {
  let total = 0;
  for (const status of unit.statuses) {
    if (status.status === 'chill') total += status.magnitude;
  }
  return Math.min(COMBAT.maxSlowFraction, total);
}

/** Total `weaken`, capped so damage output can never reach zero. */
export function weakenFraction(unit: BattleUnit): number {
  let total = 0;
  for (const status of unit.statuses) {
    if (status.status === 'weaken') total += status.magnitude;
  }
  return Math.min(COMBAT.maxWeakenFraction, total);
}

export function isStunned(unit: BattleUnit): boolean {
  return unit.statuses.some((status) => status.status === 'stun');
}

/**
 * The value of a stat right now.
 *
 * `hp` returns the modified maximum, not current HP — read `unit.hp` for that.
 */
export function effectiveStat(unit: BattleUnit, key: StatKey): number {
  const value = modifiedStat(unit, key);
  if (key === 'moveSpeed') return value * (1 - slowFraction(unit));
  if (key === 'atkSpeed') return Math.max(COMBAT.minAtkSpeed, value);
  return value;
}

/** Milliseconds between attacks at the unit's current attack speed. */
export function attackIntervalMs(unit: BattleUnit): number {
  return BATTLE.msPerSecond / effectiveStat(unit, 'atkSpeed');
}

/**
 * Milliseconds to step one cell, or `null` if the unit cannot move at all
 * (zero base move speed, or slowed to a standstill).
 */
export function stepIntervalMs(unit: BattleUnit): number | null {
  const speed = effectiveStat(unit, 'moveSpeed');
  if (speed <= 0) return null;
  return BATTLE.msPerSecond / speed;
}

/** Attack reach in cells, rounded down — range is only meaningful per cell. */
export function attackRange(unit: BattleUnit): number {
  return Math.floor(effectiveStat(unit, 'range'));
}

/**
 * Recomputes max HP after an `hp` modifier changed.
 *
 * Gaining maximum HP grants the difference as current HP — otherwise a
 * battle-start +15% max HP buff would leave the unit visibly wounded before
 * anyone had hit it.
 */
export function recomputeMaxHp(unit: BattleUnit): void {
  const previous = unit.maxHp;
  unit.maxHp = modifiedStat(unit, 'hp');
  const delta = unit.maxHp - previous;
  if (delta > 0) unit.hp += delta;
  unit.hp = Math.min(unit.hp, unit.maxHp);
}

/** Attaches a modifier, keeping derived values consistent. */
export function addMod(unit: BattleUnit, mod: ActiveMod): void {
  unit.mods.push(mod);
  if (mod.stat === 'hp') recomputeMaxHp(unit);
}

/**
 * Ages modifiers and statuses by one tick, dropping the expired ones.
 *
 * Modifiers with a `null` duration last the whole battle and are never aged.
 */
export function expireTimedEffects(unit: BattleUnit, elapsedMs: number): void {
  let hpModExpired = false;
  unit.mods = unit.mods.filter((mod) => {
    if (mod.remainingMs === null) return true;
    mod.remainingMs -= elapsedMs;
    if (mod.remainingMs > 0) return true;
    if (mod.stat === 'hp') hpModExpired = true;
    return false;
  });
  if (hpModExpired) recomputeMaxHp(unit);

  unit.statuses = unit.statuses.filter((status) => {
    status.remainingMs -= elapsedMs;
    return status.remainingMs > 0;
  });

  unit.shields = unit.shields.filter((entry) => {
    if (entry.remainingMs === null) return true;
    entry.remainingMs -= elapsedMs;
    return entry.remainingMs > 0;
  });
}

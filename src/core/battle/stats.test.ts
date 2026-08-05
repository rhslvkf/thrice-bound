import { describe, expect, it } from 'vitest';
import type { UnitDef, UnitStats } from '../../data/schema';
import { BATTLE, COMBAT } from '../config';
import { createUnit } from './spawn';
import {
  absorbWithShields,
  addMod,
  attackIntervalMs,
  attackRange,
  effectiveStat,
  expireTimedEffects,
  isStunned,
  pushShield,
  slowFraction,
  stepIntervalMs,
  totalShield,
  weakenFraction,
} from './stats';
import type { BattleUnit } from './types';

const DEFAULT_STATS: UnitStats = {
  hp: 100,
  atk: 10,
  atkSpeed: 1,
  range: 2,
  moveSpeed: 1,
};

const makeUnit = (stats: Partial<UnitStats> = {}): BattleUnit => {
  const def: UnitDef = {
    id: 'unit.dummy',
    name: 'Dummy',
    tier: 1,
    tags: ['Beast'],
    cost: 1,
    stats: { ...DEFAULT_STATS, ...stats },
    abilityId: null,
    mergesInto: [],
    artKey: 'unit/dummy',
  };
  return createUnit(def, 0, 'player', 0, 0, false);
};

describe('modifier stacking', () => {
  it('sums adds before applying multipliers', () => {
    const unit = makeUnit();
    addMod(unit, { stat: 'atk', op: 'add', amount: 10, remainingMs: null });
    addMod(unit, { stat: 'atk', op: 'mult', amount: 0.5, remainingMs: null });
    // (10 + 10) * 1.5
    expect(effectiveStat(unit, 'atk')).toBe(30);
  });

  it('adds multipliers together rather than compounding them', () => {
    const unit = makeUnit();
    addMod(unit, { stat: 'atk', op: 'mult', amount: 0.5, remainingMs: null });
    addMod(unit, { stat: 'atk', op: 'mult', amount: 0.5, remainingMs: null });
    // Two +50% buffs are +100%, not +125%.
    expect(effectiveStat(unit, 'atk')).toBe(20);
  });

  it('leaves other stats untouched', () => {
    const unit = makeUnit();
    addMod(unit, { stat: 'atk', op: 'mult', amount: 1, remainingMs: null });
    expect(effectiveStat(unit, 'moveSpeed')).toBe(DEFAULT_STATS.moveSpeed);
  });

  it('floors the combined multiplier so a stat cannot be zeroed out', () => {
    const unit = makeUnit();
    addMod(unit, { stat: 'atk', op: 'mult', amount: -5, remainingMs: null });
    expect(effectiveStat(unit, 'atk')).toBeCloseTo(
      DEFAULT_STATS.atk * COMBAT.minStatMultiplier,
      6,
    );
  });
});

describe('max HP modifiers', () => {
  it('grants the gained maximum as current HP', () => {
    const unit = makeUnit();
    addMod(unit, { stat: 'hp', op: 'mult', amount: 0.1, remainingMs: null });
    // Float arithmetic: 100 * 1.1 is not exactly 110. It is deterministic,
    // which is what the simulation needs, so the assertion is approximate.
    expect(unit.maxHp).toBeCloseTo(110, 9);
    // A battle-start buff must not leave the unit looking wounded.
    expect(unit.hp).toBeCloseTo(110, 9);
    expect(unit.hp).toBe(unit.maxHp);
  });

  it('does not heal a wounded unit beyond the new maximum', () => {
    const unit = makeUnit();
    unit.hp = 50;
    addMod(unit, { stat: 'hp', op: 'mult', amount: 0.1, remainingMs: null });
    expect(unit.maxHp).toBeCloseTo(110, 9);
    expect(unit.hp).toBeCloseTo(60, 9);
  });

  it('clamps current HP back down when the modifier expires', () => {
    const unit = makeUnit();
    addMod(unit, { stat: 'hp', op: 'mult', amount: 0.5, remainingMs: 1000 });
    expect(unit.hp).toBe(150);
    expireTimedEffects(unit, 1000);
    expect(unit.maxHp).toBe(100);
    expect(unit.hp).toBe(100);
  });
});

describe('derived rates', () => {
  it('converts attack speed to an interval', () => {
    expect(attackIntervalMs(makeUnit({ atkSpeed: 2 }))).toBe(BATTLE.msPerSecond / 2);
    expect(attackIntervalMs(makeUnit({ atkSpeed: 0.5 }))).toBe(BATTLE.msPerSecond * 2);
  });

  it('never lets attack speed reach zero, which would divide by zero', () => {
    const unit = makeUnit({ atkSpeed: 1 });
    addMod(unit, { stat: 'atkSpeed', op: 'mult', amount: -10, remainingMs: null });
    expect(effectiveStat(unit, 'atkSpeed')).toBeGreaterThan(0);
    expect(Number.isFinite(attackIntervalMs(unit))).toBe(true);
  });

  it('reports an immobile unit as unable to step', () => {
    expect(stepIntervalMs(makeUnit({ moveSpeed: 0 }))).toBeNull();
  });

  it('rounds attack range down to whole cells', () => {
    const unit = makeUnit({ range: 3 });
    addMod(unit, { stat: 'range', op: 'mult', amount: 0.5, remainingMs: null });
    // 3 * 1.5 = 4.5 -> 4 cells of reach.
    expect(attackRange(unit)).toBe(4);
  });
});

describe('statuses', () => {
  it('stacks chill and caps the total slow', () => {
    const unit = makeUnit();
    for (let i = 0; i < 5; i += 1) {
      unit.statuses.push({
        status: 'chill',
        magnitude: 0.3,
        remainingMs: 1000,
        sourceId: null,
      });
    }
    expect(slowFraction(unit)).toBe(COMBAT.maxSlowFraction);
    // Capped, so a slow stack can never immobilise.
    expect(effectiveStat(unit, 'moveSpeed')).toBeGreaterThan(0);
  });

  it('stacks weaken and caps the total', () => {
    const unit = makeUnit();
    unit.statuses.push({
      status: 'weaken',
      magnitude: 5,
      remainingMs: 1000,
      sourceId: null,
    });
    expect(weakenFraction(unit)).toBe(COMBAT.maxWeakenFraction);
  });

  it('reports a stun and drops it when it expires', () => {
    const unit = makeUnit();
    unit.statuses.push({
      status: 'stun',
      magnitude: 0,
      remainingMs: 500,
      sourceId: null,
    });
    expect(isStunned(unit)).toBe(true);
    expireTimedEffects(unit, 500);
    expect(isStunned(unit)).toBe(false);
  });

  it('keeps a permanent modifier through any amount of time', () => {
    const unit = makeUnit();
    addMod(unit, { stat: 'atk', op: 'add', amount: 5, remainingMs: null });
    for (let i = 0; i < 100; i += 1) expireTimedEffects(unit, BATTLE.tickMs);
    expect(effectiveStat(unit, 'atk')).toBe(15);
  });
});

describe('shield pool', () => {
  it('sums every entry', () => {
    const unit = makeUnit();
    pushShield(unit, { amount: 30, remainingMs: null });
    pushShield(unit, { amount: 20, remainingMs: 1000 });
    expect(totalShield(unit)).toBe(50);
  });

  it('spends the soonest-expiring shield first', () => {
    const unit = makeUnit();
    pushShield(unit, { amount: 30, remainingMs: null });
    pushShield(unit, { amount: 20, remainingMs: 1000 });

    expect(absorbWithShields(unit, 20)).toBe(20);
    // The timed shield is gone; the permanent one is untouched.
    expect(unit.shields).toHaveLength(1);
    expect(unit.shields[0]?.remainingMs).toBeNull();
    expect(totalShield(unit)).toBe(30);
  });

  it('absorbs only what it has', () => {
    const unit = makeUnit();
    pushShield(unit, { amount: 10, remainingMs: null });
    expect(absorbWithShields(unit, 25)).toBe(10);
    expect(totalShield(unit)).toBe(0);
    expect(unit.shields).toEqual([]);
  });

  it('absorbs nothing when the pool is empty', () => {
    expect(absorbWithShields(makeUnit(), 15)).toBe(0);
  });

  it('expires timed shields but never permanent ones', () => {
    const unit = makeUnit();
    pushShield(unit, { amount: 30, remainingMs: null });
    pushShield(unit, { amount: 20, remainingMs: 100 });

    expireTimedEffects(unit, 100);
    expect(totalShield(unit)).toBe(30);
    expireTimedEffects(unit, 10_000);
    expect(totalShield(unit)).toBe(30);
  });
});

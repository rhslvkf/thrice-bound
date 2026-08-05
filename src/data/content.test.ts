import { describe, expect, it } from 'vitest';
import { loadBundledGameData, mergeOptionsOf } from './loader';
import {
  MAX_TIER,
  MIN_MERGE_OPTIONS,
  MIN_TIER,
  UNIT_TAGS,
  type Effect,
  type UnitDef,
} from './schema';

const data = loadBundledGameData();
const units = [...data.units.values()];
const unitsOfTier = (tier: number): UnitDef[] => units.filter((u) => u.tier === tier);

/**
 * Rough power heuristic: effective HP times damage per second.
 *
 * Not a balance model — the simulator will produce the real numbers. It exists
 * so that a hand-edited stat block that is wildly off-curve fails a test
 * instead of quietly becoming the strongest unit in the game.
 */
const powerOf = (unit: UnitDef): number =>
  unit.stats.hp * unit.stats.atk * unit.stats.atkSpeed;

const meanPower = (tier: number): number => {
  const tierUnits = unitsOfTier(tier);
  return tierUnits.reduce((sum, u) => sum + powerOf(u), 0) / tierUnits.length;
};

/** Intended power multiplier from one tier to the next. */
const TIER_2_MULTIPLIER = 2.2;
const TIER_3_MULTIPLIER = 2.4;
/** How far the data may drift from the curve before it is a mistake. */
const CURVE_TOLERANCE = 0.1;
const UNIT_SPREAD_TOLERANCE = 0.15;

/** Yields every effect in a tree, descending into `periodic` children. */
function* walk(effects: readonly Effect[]): Generator<Effect> {
  for (const effect of effects) {
    yield effect;
    if (effect.kind === 'periodic') yield* walk(effect.effects);
  }
}

describe('content loads', () => {
  it('validates the bundled files without throwing', () => {
    expect(() => loadBundledGameData()).not.toThrow();
  });

  it('caches the parsed result', () => {
    expect(loadBundledGameData()).toBe(loadBundledGameData());
  });

  it('has the intended roster size', () => {
    expect(units).toHaveLength(28);
    expect(unitsOfTier(1)).toHaveLength(8);
    expect(unitsOfTier(2)).toHaveLength(12);
    expect(unitsOfTier(3)).toHaveLength(8);
  });
});

describe('merge graph', () => {
  it('resolves every mergesInto entry to a real unit', () => {
    for (const unit of units) {
      for (const targetId of unit.mergesInto) {
        expect(
          data.units.has(targetId),
          `${unit.id} merges into unknown unit ${targetId}`,
        ).toBe(true);
      }
    }
  });

  it('gives every tier 1 unit exactly two merge directions', () => {
    for (const unit of unitsOfTier(1)) {
      expect(unit.mergesInto, `${unit.id}`).toHaveLength(2);
    }
  });

  it('gives every tier 2 unit a real choice as well', () => {
    for (const unit of unitsOfTier(2)) {
      expect(unit.mergesInto.length, `${unit.id}`).toBeGreaterThanOrEqual(
        MIN_MERGE_OPTIONS,
      );
    }
  });

  it('leaves every tier 3 unit terminal', () => {
    for (const unit of unitsOfTier(MAX_TIER)) {
      expect(unit.mergesInto, `${unit.id}`).toEqual([]);
    }
  });

  it('only merges one tier upward', () => {
    for (const unit of units) {
      for (const target of mergeOptionsOf(data, unit.id)) {
        expect(target.tier, `${unit.id} -> ${target.id}`).toBe(unit.tier + 1);
      }
    }
  });

  it('offers distinct choices, never the same unit twice', () => {
    for (const unit of units) {
      expect(new Set(unit.mergesInto).size, `${unit.id}`).toBe(unit.mergesInto.length);
    }
  });

  it('contains no cycles', () => {
    // Walks the graph from every unit; the tier rule should make this
    // impossible, but the check does not assume the tier rule holds.
    const visit = (id: string, path: readonly string[]): void => {
      expect(path.includes(id), `cycle: ${[...path, id].join(' -> ')}`).toBe(false);
      for (const next of data.units.get(id)?.mergesInto ?? []) {
        visit(next, [...path, id]);
      }
    };
    for (const unit of units) visit(unit.id, []);
  });

  it('leaves no tier 2 or tier 3 unit unreachable by merging', () => {
    const reachable = new Set(units.flatMap((unit) => [...unit.mergesInto]));
    for (const unit of units) {
      if (unit.tier === MIN_TIER) continue;
      expect(reachable.has(unit.id), `${unit.id} cannot be reached by any merge`).toBe(
        true,
      );
    }
  });

  it('keeps every tier 1 unit able to reach a tier 3 unit', () => {
    const reachesTop = (id: string): boolean => {
      const unit = data.units.get(id);
      if (unit === undefined) return false;
      if (unit.tier === MAX_TIER) return true;
      return unit.mergesInto.some(reachesTop);
    };
    for (const unit of unitsOfTier(1)) {
      expect(reachesTop(unit.id), `${unit.id} dead-ends before tier ${MAX_TIER}`).toBe(
        true,
      );
    }
  });
});

describe('ability references', () => {
  it('resolves every abilityId', () => {
    for (const unit of units) {
      if (unit.abilityId === null) continue;
      expect(
        data.abilities.has(unit.abilityId),
        `${unit.id} references unknown ability ${unit.abilityId}`,
      ).toBe(true);
    }
  });

  it('leaves no ability defined but unused', () => {
    const used = new Set(
      units.map((unit) => unit.abilityId).filter((id): id is string => id !== null),
    );
    for (const ability of data.abilities.values()) {
      expect(used.has(ability.id), `${ability.id} is defined but no unit uses it`).toBe(
        true,
      );
    }
  });

  it('resolves every summoned unit id', () => {
    for (const ability of data.abilities.values()) {
      for (const effect of walk(ability.effects)) {
        if (effect.kind !== 'summon') continue;
        expect(
          data.units.has(effect.unitId),
          `${ability.id} summons unknown unit ${effect.unitId}`,
        ).toBe(true);
      }
    }
  });

  it('gives interval abilities an interval and nothing else one', () => {
    for (const ability of data.abilities.values()) {
      const expectsInterval = ability.trigger === 'interval';
      expect(ability.intervalMs !== null, `${ability.id}`).toBe(expectsInterval);
    }
  });
});

describe('tags and synergies', () => {
  it('defines exactly one synergy per tag', () => {
    expect([...data.synergies.values()].map((s) => s.tag).sort()).toEqual(
      [...UNIT_TAGS].sort(),
    );
  });

  it('gives every synergy a 3-unit and a 5-unit threshold', () => {
    for (const synergy of data.synergies.values()) {
      expect(
        synergy.thresholds.map((t) => t.count),
        `${synergy.id}`,
      ).toEqual([3, 5]);
    }
  });

  it('only uses tags that units actually carry', () => {
    const carried = new Set(units.flatMap((unit) => [...unit.tags]));
    for (const tag of UNIT_TAGS) {
      expect(carried.has(tag), `no unit carries tag ${tag}`).toBe(true);
    }
  });

  it('leaves enough units per tag to reach the 5-unit threshold', () => {
    for (const tag of UNIT_TAGS) {
      const count = units.filter((unit) => unit.tags.includes(tag)).length;
      expect(count, `tag ${tag}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('targets its own tag in every synergy effect that filters by tag', () => {
    for (const synergy of data.synergies.values()) {
      for (const threshold of synergy.thresholds) {
        for (const effect of walk(threshold.effects)) {
          if (!('target' in effect) || effect.target.mode !== 'alliesWithTag') continue;
          expect(effect.target.tag, `${synergy.id}`).toBe(synergy.tag);
        }
      }
    }
  });
});

describe('stat curve', () => {
  it('scales tier 2 to roughly 2.2x tier 1', () => {
    const ratio = meanPower(2) / meanPower(1);
    expect(ratio).toBeGreaterThan(TIER_2_MULTIPLIER * (1 - CURVE_TOLERANCE));
    expect(ratio).toBeLessThan(TIER_2_MULTIPLIER * (1 + CURVE_TOLERANCE));
  });

  it('scales tier 3 to roughly 2.4x tier 2', () => {
    const ratio = meanPower(3) / meanPower(2);
    expect(ratio).toBeGreaterThan(TIER_3_MULTIPLIER * (1 - CURVE_TOLERANCE));
    expect(ratio).toBeLessThan(TIER_3_MULTIPLIER * (1 + CURVE_TOLERANCE));
  });

  it('keeps every unit near its own tier average', () => {
    for (let tier = MIN_TIER; tier <= MAX_TIER; tier += 1) {
      const average = meanPower(tier);
      for (const unit of unitsOfTier(tier)) {
        const drift = Math.abs(powerOf(unit) - average) / average;
        expect(drift, `${unit.id} is ${(drift * 100).toFixed(1)}% off tier ${tier}`).
          toBeLessThan(UNIT_SPREAD_TOLERANCE);
      }
    }
  });

  it('never lets a unit cost less than a lower-tier unit', () => {
    const maxCostOfTier = (tier: number) =>
      Math.max(...unitsOfTier(tier).map((u) => u.cost));
    const minCostOfTier = (tier: number) =>
      Math.min(...unitsOfTier(tier).map((u) => u.cost));
    expect(minCostOfTier(2)).toBeGreaterThanOrEqual(maxCostOfTier(1));
    expect(minCostOfTier(3)).toBeGreaterThanOrEqual(maxCostOfTier(2));
  });
});

describe('art keys', () => {
  it('gives every definition a placeholder art key', () => {
    const everything = [
      ...units,
      ...data.abilities.values(),
      ...data.synergies.values(),
      ...data.relics.values(),
      ...data.encounters,
    ];
    for (const def of everything) {
      expect(def.artKey, `${def.id}`).toMatch(/^[a-z]+\/[a-z0-9_]+$/);
    }
  });

  it('keeps unit art keys unique', () => {
    const keys = units.map((unit) => unit.artKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('encounters', () => {
  it('covers consecutive rounds starting at 1', () => {
    expect(data.encounters.map((e) => e.round)).toEqual(
      data.encounters.map((_, index) => index + 1),
    );
  });

  it('references only real units', () => {
    for (const encounter of data.encounters) {
      for (const placement of encounter.placements) {
        expect(
          data.units.has(placement.unitId),
          `${encounter.id} places unknown unit ${placement.unitId}`,
        ).toBe(true);
      }
    }
  });

  it('grows in reward as rounds progress', () => {
    const rewards = data.encounters.map((e) => e.goldReward);
    for (let i = 1; i < rewards.length; i += 1) {
      expect(rewards[i] as number).toBeGreaterThan(rewards[i - 1] as number);
    }
  });
});

describe('relics', () => {
  it('resolves every granted unit id', () => {
    for (const relic of data.relics.values()) {
      for (const hook of relic.hooks) {
        for (const action of hook.actions) {
          if (action.kind !== 'grantUnit') continue;
          expect(
            data.units.has(action.unitId),
            `${relic.id} grants unknown unit ${action.unitId}`,
          ).toBe(true);
        }
      }
    }
  });

  it('covers more than one rarity', () => {
    const rarities = new Set([...data.relics.values()].map((r) => r.rarity));
    expect(rarities.size).toBeGreaterThan(1);
  });
});

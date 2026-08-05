import { describe, expect, it } from 'vitest';
import type { BattleEvent, BattleResult, BattleState } from '../core/battle/index';
import { MAX_TICKS } from '../core/config';
import { loadBundledGameData } from '../data/loader';
import {
  avgDamageDealt,
  avgDamageTaken,
  DAMAGE_SCALE,
  deathRate,
  emptyAggregate,
  mergeAggregates,
  mergeDecisions,
  mergeWinRate,
  recordBattle,
  recordMergeSample,
  summariseDurations,
  widestGapPp,
  winRate,
} from './metrics';
import type { Aggregate } from './metrics';

const data = loadBundledGameData();

/** A minimal finished state; only the fields the metrics read matter. */
const emptyState: BattleState = {
  tick: 0,
  rngState: 0,
  units: [],
  periodics: [],
  nextInstanceId: 0,
  startingHp: { player: 0, enemy: 0 },
  outcome: 'player',
  endReason: 'wipe',
};

function battle(
  outcome: BattleResult['outcome'],
  ticks: number,
  events: BattleEvent[],
  reason: BattleResult['reason'] = 'wipe',
): BattleResult {
  return { outcome, reason, ticks, events, finalState: emptyState };
}

const spawn = (
  instanceId: number,
  defId: string,
  team: 'player' | 'enemy',
  summoned = false,
): BattleEvent => ({
  kind: 'spawn',
  tick: 0,
  instanceId,
  defId,
  team,
  col: 0,
  row: 0,
  hp: 100,
  maxHp: 100,
  summoned,
});

const damage = (
  tick: number,
  sourceId: number | null,
  targetId: number,
  amount: number,
): BattleEvent => ({
  kind: 'damage',
  tick,
  sourceId,
  targetId,
  amount,
  absorbed: 0,
  damageType: 'physical',
  source: 'attack',
  hpAfter: 0,
  shieldAfter: 0,
  lethal: false,
});

const death = (tick: number, instanceId: number): BattleEvent => ({
  kind: 'death',
  tick,
  instanceId,
  killerId: null,
});

const synergyApplied = (
  team: 'player' | 'enemy',
  synergyId: string,
  tag: string,
  thresholdCount: number,
): BattleEvent => ({
  kind: 'synergyApplied',
  tick: 0,
  team,
  synergyId,
  tag: tag as 'Beast',
  unitCount: thresholdCount,
  thresholdCount,
  description: '',
  affectedIds: [],
});

// ---------------------------------------------------------------------------

describe('unit presence and win rate', () => {
  it('counts a unit once per team per battle, however many bodies it has', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('player', 100, [
        spawn(0, 'unit.thornling', 'player'),
        spawn(1, 'unit.thornling', 'player'),
        spawn(2, 'unit.grave_rat', 'enemy'),
      ]),
    );

    const thornling = aggregate.units['unit.thornling'];
    expect(thornling?.presence).toBe(1);
    expect(thornling?.instances).toBe(2);
    expect(thornling?.presenceWins).toBe(1);
  });

  it('credits the win to the winning side only', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('enemy', 100, [
        spawn(0, 'unit.thornling', 'player'),
        spawn(1, 'unit.grave_rat', 'enemy'),
      ]),
    );
    expect(aggregate.units['unit.thornling']?.presenceWins).toBe(0);
    expect(aggregate.units['unit.grave_rat']?.presenceWins).toBe(1);
  });

  it('scores a draw as half a win for both sides', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('draw', 100, [
        spawn(0, 'unit.thornling', 'player'),
        spawn(1, 'unit.grave_rat', 'enemy'),
      ]),
    );
    const stat = aggregate.units['unit.thornling'];
    expect(stat?.presenceDraws).toBe(1);
    expect(winRate(stat ?? { presence: 0, presenceWins: 0, presenceDraws: 0 })).toBe(0.5);
  });

  it('excludes summoned bodies from every per-unit figure', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('player', 100, [
        spawn(0, 'unit.bone_acolyte', 'player'),
        spawn(1, 'unit.grave_rat', 'player', true),
        spawn(2, 'unit.dire_pup', 'enemy'),
        damage(10, 1, 2, 50),
      ]),
    );
    // The summoned rat contributed damage, but it was never chosen by anyone,
    // so it must not gain an appearance of its own.
    expect(aggregate.units['unit.grave_rat']).toBeUndefined();
    expect(aggregate.units['unit.bone_acolyte']?.presence).toBe(1);
  });
});

describe('damage attribution', () => {
  it('credits dealt and taken to the right units', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('player', 100, [
        spawn(0, 'unit.thornling', 'player'),
        spawn(1, 'unit.grave_rat', 'enemy'),
        damage(5, 0, 1, 30),
        damage(6, 1, 0, 12.5),
      ]),
    );
    expect(avgDamageDealt(aggregate.units['unit.thornling'] ?? emptyStat())).toBeCloseTo(30, 6);
    expect(avgDamageTaken(aggregate.units['unit.thornling'] ?? emptyStat())).toBeCloseTo(12.5, 6);
    expect(avgDamageDealt(aggregate.units['unit.grave_rat'] ?? emptyStat())).toBeCloseTo(12.5, 6);
  });

  it('ignores friendly fire when crediting damage dealt', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('player', 100, [
        spawn(0, 'unit.thornling', 'player'),
        spawn(1, 'unit.dire_pup', 'player'),
        spawn(2, 'unit.grave_rat', 'enemy'),
        damage(5, 0, 1, 40),
      ]),
    );
    // The hit still counts as damage taken, but not as output.
    expect(avgDamageDealt(aggregate.units['unit.thornling'] ?? emptyStat())).toBe(0);
    expect(avgDamageTaken(aggregate.units['unit.dire_pup'] ?? emptyStat())).toBeCloseTo(40, 6);
  });

  it('stores damage as whole thousandths so merging is exact', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('player', 100, [
        spawn(0, 'unit.thornling', 'player'),
        spawn(1, 'unit.grave_rat', 'enemy'),
        damage(5, 0, 1, 1 / 3),
      ]),
    );
    const stat = aggregate.units['unit.thornling'];
    expect(Number.isInteger(stat?.damageDealtMilli)).toBe(true);
    expect(stat?.damageDealtMilli).toBe(Math.round((1 / 3) * DAMAGE_SCALE));
  });
});

describe('survival', () => {
  it('records the death tick for a unit that fell', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('enemy', 200, [
        spawn(0, 'unit.thornling', 'player'),
        spawn(1, 'unit.grave_rat', 'enemy'),
        death(120, 0),
      ]),
    );
    expect(aggregate.units['unit.thornling']?.survivalTicks).toBe(120);
    expect(deathRate(aggregate.units['unit.thornling'] ?? emptyStat())).toBe(1);
  });

  it('credits a survivor with the full battle length', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('player', 200, [
        spawn(0, 'unit.thornling', 'player'),
        spawn(1, 'unit.grave_rat', 'enemy'),
        death(120, 1),
      ]),
    );
    expect(aggregate.units['unit.thornling']?.survivalTicks).toBe(200);
    expect(deathRate(aggregate.units['unit.thornling'] ?? emptyStat())).toBe(0);
  });
});

describe('synergy accounting', () => {
  it('splits teams into active-at-this-tier and synergy-off', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('player', 100, [
        spawn(0, 'unit.grave_rat', 'player'),
        spawn(1, 'unit.dire_pup', 'enemy'),
        synergyApplied('player', 'synergy.undead', 'Undead', 3),
      ]),
    );

    const tier3 = aggregate.synergies['synergy.undead@3'];
    expect(tier3?.activeTeams).toBe(1);
    expect(tier3?.activeWins).toBe(1);
    // The enemy had no Undead synergy at all, so it lands in the inactive arm.
    expect(tier3?.inactiveTeams).toBe(1);
    expect(tier3?.inactiveWins).toBe(0);
  });

  it('does not count a team on a lower tier as inactive for a higher one', () => {
    const aggregate = emptyAggregate();
    recordBattle(
      aggregate,
      data,
      battle('player', 100, [
        spawn(0, 'unit.grave_rat', 'player'),
        spawn(1, 'unit.dire_pup', 'enemy'),
        synergyApplied('player', 'synergy.undead', 'Undead', 3),
      ]),
    );
    const tier5 = aggregate.synergies['synergy.undead@5'];
    // The player team is running tier 3, so it belongs to neither arm of the
    // tier 5 comparison — otherwise the tier 5 row would measure the upgrade.
    expect(tier5?.activeTeams).toBe(0);
    expect(tier5?.inactiveTeams).toBe(1);
  });
});

describe('mergeAggregates', () => {
  it('adds two aggregates into one', () => {
    const a = emptyAggregate();
    const b = emptyAggregate();
    const events = [
      spawn(0, 'unit.thornling', 'player'),
      spawn(1, 'unit.grave_rat', 'enemy'),
      damage(5, 0, 1, 10),
    ];
    recordBattle(a, data, battle('player', 100, events));
    recordBattle(b, data, battle('enemy', 300, events));

    mergeAggregates(a, b);
    expect(a.matches).toBe(2);
    expect(a.outcomes.player).toBe(1);
    expect(a.outcomes.enemy).toBe(1);
    expect(a.units['unit.thornling']?.presence).toBe(2);
    expect(a.units['unit.thornling']?.damageDealtMilli).toBe(20 * DAMAGE_SCALE);
    expect(a.tickHistogram[100]).toBe(1);
    expect(a.tickHistogram[300]).toBe(1);
  });

  it('is order-independent, which is what makes worker counts irrelevant', () => {
    const build = (outcome: BattleResult['outcome'], ticks: number): Aggregate => {
      const aggregate = emptyAggregate();
      recordBattle(
        aggregate,
        data,
        battle(outcome, ticks, [
          spawn(0, 'unit.thornling', 'player'),
          spawn(1, 'unit.grave_rat', 'enemy'),
          damage(5, 0, 1, 1 / 7),
        ]),
      );
      return aggregate;
    };

    const forwards = mergeAggregates(
      mergeAggregates(build('player', 100), build('enemy', 200)),
      build('draw', 300),
    );
    const backwards = mergeAggregates(
      mergeAggregates(build('draw', 300), build('enemy', 200)),
      build('player', 100),
    );
    expect(forwards.units['unit.thornling']?.damageDealtMilli).toBe(
      backwards.units['unit.thornling']?.damageDealtMilli,
    );
    expect(forwards.matches).toBe(backwards.matches);
  });

  it('merges into an empty aggregate without inventing entries', () => {
    const target = emptyAggregate();
    mergeAggregates(target, emptyAggregate());
    expect(target.matches).toBe(0);
    expect(Object.keys(target.units)).toEqual([]);
  });
});

describe('merge paths', () => {
  it('scores each arm from the player side', () => {
    const aggregate = emptyAggregate();
    const result = battle('player', 100, []);
    recordMergeSample(aggregate, 'unit.thornling', 'unit.moss_warden', result);
    recordMergeSample(aggregate, 'unit.thornling', 'unit.bramble_stalker', battle('enemy', 100, []));

    const stats = aggregate.mergePaths;
    expect(stats['unit.thornling>unit.moss_warden']?.wins).toBe(1);
    expect(stats['unit.thornling>unit.bramble_stalker']?.wins).toBe(0);
  });

  it('groups arms under their parent decision', () => {
    const aggregate = emptyAggregate();
    recordMergeSample(aggregate, 'unit.thornling', 'unit.moss_warden', battle('player', 1, []));
    recordMergeSample(aggregate, 'unit.thornling', 'unit.bramble_stalker', battle('enemy', 1, []));
    recordMergeSample(aggregate, 'unit.dire_pup', 'unit.alpha_howler', battle('player', 1, []));

    const decisions = mergeDecisions(aggregate);
    expect(decisions.map((d) => d.parentId)).toEqual(['unit.dire_pup', 'unit.thornling']);
    expect(decisions[1]?.arms).toHaveLength(2);
  });

  it('measures the gap between the best and worst arm', () => {
    const arms = [
      { parentId: 'p', optionId: 'a', samples: 100, wins: 70, draws: 0 },
      { parentId: 'p', optionId: 'b', samples: 100, wins: 40, draws: 0 },
    ];
    expect(mergeWinRate(arms[0] as never)).toBeCloseTo(0.7, 6);
    expect(widestGapPp(arms)).toBeCloseTo(30, 6);
  });

  it('reports no gap for a decision with a single arm', () => {
    expect(widestGapPp([{ parentId: 'p', optionId: 'a', samples: 10, wins: 5, draws: 0 }])).toBe(0);
  });
});

describe('duration summary', () => {
  it('computes exact percentiles from the histogram', () => {
    const histogram = new Array<number>(MAX_TICKS + 1).fill(0);
    // Ten battles: 100, 200, ..., 1000 ticks.
    for (let i = 1; i <= 10; i += 1) histogram[i * 100] = 1;

    const summary = summariseDurations(histogram, [10, 50, 90]);
    expect(summary.count).toBe(10);
    expect(summary.mean).toBeCloseTo(550, 6);
    expect(summary.min).toBe(100);
    expect(summary.max).toBe(1000);
    expect(summary.percentiles[10]).toBe(100);
    expect(summary.percentiles[50]).toBe(500);
    expect(summary.percentiles[90]).toBe(900);
  });

  it('handles an empty histogram', () => {
    const summary = summariseDurations(new Array<number>(10).fill(0), [50]);
    expect(summary.count).toBe(0);
    expect(summary.mean).toBe(0);
  });
});

function emptyStat() {
  return {
    presence: 0,
    presenceWins: 0,
    presenceDraws: 0,
    instances: 0,
    deaths: 0,
    survivalTicks: 0,
    damageDealtMilli: 0,
    damageTakenMilli: 0,
  };
}

import { describe, expect, it } from 'vitest';
import { loadBundledGameData } from '../../data/loader';
import { MAX_TICKS } from '../config';
import {
  createBattle,
  runBattle,
  stepBattle,
  totalShield,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type Deployment,
} from './index';

const data = loadBundledGameData();

const p = (unitId: string, col: number, row: number): Deployment => ({ unitId, col, row });
const e = p;

/** A battle with abilities on both sides, so RNG actually matters. */
const MIXED: BattleSetup = {
  seed: 1234,
  player: [
    p('unit.thornling', 1, 3),
    p('unit.spark_imp', 2, 3),
    p('unit.scrap_sentry', 3, 2),
  ],
  enemy: [
    e('unit.grave_rat', 1, 1),
    e('unit.bone_acolyte', 2, 0),
    e('unit.dire_pup', 3, 1),
  ],
};

const duel = (playerUnit: string, enemyUnit: string, seed = 7): BattleSetup => ({
  seed,
  player: [p(playerUnit, 2, 3)],
  enemy: [e(enemyUnit, 2, 0)],
});

const eventsOf = (setup: BattleSetup): readonly BattleEvent[] =>
  runBattle(data, setup).events;

/** Narrows an event list to one kind, so its own fields are readable. */
const ofKind =
  <K extends BattleEvent['kind']>(kind: K) =>
  (event: BattleEvent): event is Extract<BattleEvent, { kind: K }> =>
    event.kind === kind;

const pick = <K extends BattleEvent['kind']>(
  events: readonly BattleEvent[],
  kind: K,
): Extract<BattleEvent, { kind: K }>[] => events.filter(ofKind(kind));

// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces byte-identical results across 100 runs of the same seed', () => {
    const signature = (setup: BattleSetup): string => {
      const result = runBattle(data, setup);
      return JSON.stringify({
        outcome: result.outcome,
        reason: result.reason,
        ticks: result.ticks,
        events: result.events,
        units: result.finalState.units,
      });
    };

    const baseline = signature(MIXED);
    for (let run = 0; run < 100; run += 1) {
      expect(signature(MIXED), `run ${run} diverged`).toBe(baseline);
    }
  });

  it('produces a different battle for a different seed', () => {
    // The mixed battle turns on chance-based abilities, so the seed must show.
    const a = JSON.stringify(eventsOf({ ...MIXED, seed: 1 }));
    const b = JSON.stringify(eventsOf({ ...MIXED, seed: 2 }));
    expect(a).not.toBe(b);
  });

  it('steps the same state to the same next state every time', () => {
    const { state } = createBattle(data, MIXED);
    const first = stepBattle(data, state);
    const second = stepBattle(data, state);
    expect(JSON.stringify(second.state)).toBe(JSON.stringify(first.state));
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
  });

  it('never mutates the state handed to it', () => {
    const { state } = createBattle(data, MIXED);
    const before = JSON.stringify(state);
    for (let i = 0; i < 20; i += 1) stepBattle(data, state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('survives a JSON round-trip mid-battle and continues identically', () => {
    // The whole state is plain data, so a saved battle must resume unchanged.
    let direct = createBattle(data, MIXED).state;
    for (let i = 0; i < 30; i += 1) direct = stepBattle(data, direct).state;

    let revived = createBattle(data, MIXED).state;
    for (let i = 0; i < 30; i += 1) {
      revived = JSON.parse(JSON.stringify(revived)) as BattleState;
      revived = stepBattle(data, revived).state;
    }
    expect(JSON.stringify(revived)).toBe(JSON.stringify(direct));
  });

  it('matches a recorded golden signature', () => {
    // The checks above compare runs against each other, so they would still
    // pass if an "optimisation" changed every outcome consistently. This pins
    // the outcomes themselves: if it fails, battle results moved, and updating
    // it is a deliberate act that invalidates stored replays and balance
    // baselines.
    const parts: string[] = [];
    for (const setup of [MIXED, duel('unit.rot_knight', 'unit.plague_hound')]) {
      const result = runBattle(data, setup);
      parts.push(
        [
          result.outcome,
          result.reason,
          result.ticks,
          result.events.length,
          result.finalState.units
            .map((u) => `${u.instanceId}/${u.alive ? 1 : 0}/${u.col},${u.row}/${Math.round(u.hp * 1e6)}`)
            .join(';'),
        ].join(':'),
      );
    }
    expect(parts).toEqual([
      'player:wipe:190:102:0/0/1,1/0;1/1/2,3/75000000;2/1/3,1/60000000;3/0/1,1/0;4/0/2,0/0;5/0/3,1/0;6/0/2,0/0',
      'enemy:wipe:174:485:0/0/2,2/0;1/1/3,1/50000000',
    ]);
  });

  it('reads no clock and calls no host random source', () => {
    // A battle run with Math.random and Date.now replaced by throwing stubs
    // must still complete: core may touch neither.
    const realRandom = Math.random;
    const realNow = Date.now;
    Math.random = () => {
      throw new Error('core called Math.random');
    };
    Date.now = () => {
      throw new Error('core called Date.now');
    };
    try {
      expect(() => runBattle(data, MIXED)).not.toThrow();
    } finally {
      Math.random = realRandom;
      Date.now = realNow;
    }
  });
});

// ---------------------------------------------------------------------------

describe('one-on-one outcomes', () => {
  // Deployment order decides instance ids, and lower ids act first, so a
  // mirror match is won by whoever is deployed as the player. Each pairing is
  // therefore checked from both sides: a genuine stat advantage must win
  // regardless of which side it starts on.
  const lopsided: readonly [strong: string, weak: string][] = [
    ['unit.primal_avatar', 'unit.grave_rat'],
    ['unit.titan_of_the_forge', 'unit.thornling'],
    ['unit.archon_of_ash', 'unit.dire_pup'],
    ['unit.bone_leviathan', 'unit.spark_imp'],
    ['unit.rot_knight', 'unit.forge_apprentice'],
  ];

  for (const [strong, weak] of lopsided) {
    it(`${strong} beats ${weak} from either side`, () => {
      expect(runBattle(data, duel(strong, weak)).outcome).toBe('player');
      expect(runBattle(data, duel(weak, strong)).outcome).toBe('enemy');
    });
  }

  it('leaves the winner alive and the loser dead', () => {
    const result = runBattle(data, duel('unit.primal_avatar', 'unit.grave_rat'));
    expect(result.reason).toBe('wipe');
    const [winner] = result.finalState.units.filter((unit) => unit.team === 'player');
    const [loser] = result.finalState.units.filter((unit) => unit.team === 'enemy');
    expect(winner?.alive).toBe(true);
    expect(winner?.hp).toBeGreaterThan(0);
    expect(loser?.alive).toBe(false);
    expect(loser?.hp).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('ability triggers', () => {
  const abilityEvents = (setup: BattleSetup, abilityId: string) =>
    pick(eventsOf(setup), 'ability').filter(
      (event) => event.abilityId === abilityId,
    );

  it('fires onSpawn at tick 0, before any fighting', () => {
    const fired = abilityEvents(
      {
        seed: 5,
        player: [p('unit.rune_scribe', 2, 3), p('unit.scrap_sentry', 2, 2)],
        enemy: [e('unit.grave_rat', 2, 0)],
      },
      'ability.runic_ward',
    );
    expect(fired).toHaveLength(1);
    expect(fired[0]?.tick).toBe(0);
    expect(fired[0]?.trigger).toBe('onSpawn');
  });

  it('fires onAttack on the same tick as the attack that caused it', () => {
    const setup: BattleSetup = {
      seed: 5,
      player: [p('unit.plague_hound', 2, 3)],
      enemy: [e('unit.scrap_sentry', 2, 0)],
    };
    const events = eventsOf(setup);
    const attackTicks = pick(events, 'attack')
      .filter((event) => event.instanceId === 0)
      .map((event) => event.tick);
    const procTicks = pick(events, 'ability')
      .filter((event) => event.abilityId === 'ability.plague_bite')
      .map((event) => event.tick);

    expect(procTicks.length).toBeGreaterThan(0);
    // `plague_bite` has chance 1, so every attack must proc it.
    expect(procTicks).toEqual(attackTicks);
    // ...and each proc must leave poison on the target.
    const poison = pick(events, 'status').filter(
      (event) => event.status === 'poison',
    );
    expect(poison).toHaveLength(procTicks.length);
  });

  it('fires onHit on the unit that was struck, hitting back at the attacker', () => {
    const events = eventsOf({
      seed: 5,
      player: [p('unit.thornling', 2, 3)],
      enemy: [e('unit.dire_pup', 2, 0)],
    });
    const procs = pick(events, 'ability').filter(
      (event) => event.abilityId === 'ability.thorn_burst',
    );
    expect(procs.length).toBeGreaterThan(0);

    for (const proc of procs) {
      expect(proc.trigger).toBe('onHit');
      // The thornling retaliates, so the target is its attacker.
      expect(proc.targetIds).toEqual([1]);
      // It can only trigger on a tick where it was actually hit.
      const hitThisTick = pick(events, 'damage').some(
        (event) =>
          event.tick === proc.tick &&
          event.targetId === 0 &&
          event.source === 'attack',
      );
      expect(hitThisTick, `no incoming attack on tick ${proc.tick}`).toBe(true);
    }
  });

  it('fires onDeath on the tick its owner dies', () => {
    const events = eventsOf({
      seed: 5,
      player: [p('unit.primal_avatar', 2, 3)],
      enemy: [e('unit.bone_acolyte', 2, 0)],
    });
    const death = pick(events, 'death').find((event) => event.instanceId === 1);
    const proc = pick(events, 'ability').find(
      (event) => event.abilityId === 'ability.raise_wisp',
    );
    const summon = pick(events, 'spawn').find((event) => event.summoned);

    expect(death).toBeDefined();
    expect(proc?.tick).toBe(death?.tick);
    expect(summon?.tick).toBe(death?.tick);
    expect(summon?.defId).toBe('unit.grave_rat');
  });

  it('fires interval abilities exactly on their period, without drift', () => {
    const events = eventsOf({
      seed: 5,
      player: [p('unit.moss_warden', 2, 3)],
      enemy: [e('unit.titan_of_the_forge', 2, 0)],
    });
    const ticks = pick(events, 'ability')
      .filter((event) => event.abilityId === 'ability.rooted_growth')
      .map((event) => event.tick);

    // 3000ms at 50ms per tick is every 60th tick, starting at 60.
    expect(ticks.length).toBeGreaterThan(5);
    ticks.forEach((tick, index) => expect(tick).toBe((index + 1) * 60));
  });

  it('fires onAllyDeath on the survivor, not the unit that fell', () => {
    const events = eventsOf({
      seed: 5,
      // The rat is closer, so it is targeted and dies first; the knight lives
      // to react.
      player: [p('unit.rot_knight', 0, 3), p('unit.grave_rat', 2, 2)],
      enemy: [e('unit.primal_avatar', 2, 0)],
    });
    const allyDeath = pick(events, 'death').find((event) => event.instanceId === 1);
    const proc = pick(events, 'ability').find(
      (event) => event.abilityId === 'ability.grave_pact',
    );

    expect(allyDeath).toBeDefined();
    expect(proc?.instanceId).toBe(0);
    expect(proc?.tick).toBe(allyDeath?.tick);

    const buff = pick(events, 'statMod').find((event) => event.stat === 'atk');
    expect(buff?.amount).toBe(4);
    expect(buff?.tick).toBe(allyDeath?.tick);
  });

  it('respects an ability cooldown between procs', () => {
    // `thorn_burst` has an 800ms cooldown, so it cannot proc on consecutive
    // ticks however often the unit is hit.
    const ticks = pick(
      eventsOf({
        seed: 5,
        player: [p('unit.thornling', 2, 3)],
        enemy: [e('unit.plague_hound', 2, 0), e('unit.dire_pup', 1, 0)],
      }),
      'ability',
    )
      .filter((event) => event.abilityId === 'ability.thorn_burst')
      .map((event) => event.tick);

    for (let i = 1; i < ticks.length; i += 1) {
      const gapMs = ((ticks[i] as number) - (ticks[i - 1] as number)) * 50;
      expect(gapMs).toBeGreaterThanOrEqual(800);
    }
  });
});

// ---------------------------------------------------------------------------

describe('synergy thresholds', () => {
  const ROW = 3;
  const layout = (ids: readonly string[]): Deployment[] =>
    ids.map((unitId, index) => p(unitId, index, ROW));

  const synergiesFor = (ids: readonly string[]) =>
    pick(
      createBattle(data, {
        seed: 1,
        player: layout(ids),
        enemy: [e('unit.grave_rat', 2, 0)],
      }).events,
      'synergyApplied',
    ).filter((event) => event.team === 'player');

  it('stays inactive below the first threshold', () => {
    expect(synergiesFor(['unit.grave_rat', 'unit.bone_acolyte'])).toEqual([]);
  });

  it('applies the 3-unit tier at exactly three', () => {
    const [synergy] = synergiesFor([
      'unit.grave_rat',
      'unit.bone_acolyte',
      'unit.rot_knight',
    ]);
    expect(synergy?.tag).toBe('Undead');
    expect(synergy?.unitCount).toBe(3);
    expect(synergy?.thresholdCount).toBe(3);
  });

  it('holds at the 3-unit tier for four units', () => {
    const [synergy] = synergiesFor([
      'unit.grave_rat',
      'unit.bone_acolyte',
      'unit.rot_knight',
      'unit.plague_hound',
    ]);
    expect(synergy?.unitCount).toBe(4);
    expect(synergy?.thresholdCount).toBe(3);
  });

  it('upgrades to the 5-unit tier at exactly five, and only that tier', () => {
    const applied = synergiesFor([
      'unit.grave_rat',
      'unit.bone_acolyte',
      'unit.rot_knight',
      'unit.plague_hound',
      'unit.crypt_weaver',
    ]);
    const undead = applied.filter((event) => event.tag === 'Undead');
    // Only the highest satisfied tier applies, never both cumulatively.
    expect(undead).toHaveLength(1);
    expect(undead[0]?.unitCount).toBe(5);
    expect(undead[0]?.thresholdCount).toBe(5);
  });

  it('counts distinct unit types, so duplicates do not stack a tag', () => {
    expect(
      synergiesFor(['unit.grave_rat', 'unit.grave_rat', 'unit.grave_rat']),
    ).toEqual([]);
  });

  it('actually applies the effects, not just the event', () => {
    const start = createBattle(data, {
      seed: 1,
      // None of these three shields itself, so the whole pool is the synergy's.
      player: layout([
        'unit.scrap_sentry',
        'unit.forge_apprentice',
        'unit.blade_dancer',
      ]),
      enemy: [e('unit.grave_rat', 2, 0)],
    });
    // Forged Line at 3 grants every Steel ally a 15% max HP shield.
    for (const unit of start.state.units.filter((u) => u.team === 'player')) {
      expect(totalShield(unit), unit.defId).toBeCloseTo(unit.maxHp * 0.15, 6);
    }
    for (const unit of start.state.units.filter((u) => u.team === 'enemy')) {
      expect(totalShield(unit)).toBe(0);
    }
  });

  it('keeps a team aura running after the unit that anchored it dies', () => {
    // Unquiet Dead regenerates the team; it must not stop because one
    // particular Undead fell.
    const result = runBattle(data, {
      seed: 11,
      player: layout(['unit.grave_rat', 'unit.bone_acolyte', 'unit.rot_knight']),
      enemy: [e('unit.primal_avatar', 2, 0), e('unit.alpha_howler', 3, 0)],
    });
    const firstDeath = pick(result.events, 'death').find((event) => event.tick > 0);
    expect(firstDeath).toBeDefined();
    const healsAfter = pick(result.events, 'heal').filter(
      (event) => event.tick > (firstDeath?.tick ?? 0),
    );
    expect(healsAfter.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('termination', () => {
  it('stops at the tick cap instead of looping forever', () => {
    // A self-healing colossus against a slow titan: neither can finish the
    // other inside the time limit.
    const result = runBattle(
      data,
      duel('unit.verdant_colossus', 'unit.titan_of_the_forge'),
    );
    expect(result.reason).toBe('timeout');
    expect(result.ticks).toBe(MAX_TICKS);
    expect(result.finalState.units.every((unit) => unit.alive)).toBe(true);
  });

  it('awards a timeout to the side holding the larger HP fraction', () => {
    const result = runBattle(
      data,
      duel('unit.verdant_colossus', 'unit.titan_of_the_forge'),
    );
    const fraction = (team: string): number => {
      const units = result.finalState.units.filter((unit) => unit.team === team);
      const remaining = units.reduce((sum, u) => sum + u.hp + totalShield(u), 0);
      const starting = result.finalState.startingHp[team === 'player' ? 'player' : 'enemy'];
      return remaining / starting;
    };
    expect(result.outcome).toBe('player');
    expect(fraction('player')).toBeGreaterThan(fraction('enemy'));
  });

  it('calls a mutual wipe a draw', () => {
    // Bone Leviathan's death throes can take its killer with it.
    const result = runBattle(data, duel('unit.bone_leviathan', 'unit.bone_leviathan'));
    expect(result.reason).toBe('mutualWipe');
    expect(result.outcome).toBe('draw');
    expect(result.finalState.units.every((unit) => !unit.alive)).toBe(true);
  });

  it('terminates for every pairing of the whole roster', () => {
    // The real guard against an infinite loop: no matchup may run past the cap.
    const ids = [...data.units.keys()];
    for (const attacker of ids) {
      for (const defender of ids) {
        const result = runBattle(data, duel(attacker, defender, 99));
        expect(result.ticks, `${attacker} vs ${defender}`).toBeLessThanOrEqual(
          MAX_TICKS,
        );
        expect(result.outcome).toBeDefined();
      }
    }
  });

  it('is a no-op once the battle is over', () => {
    const result = runBattle(data, duel('unit.primal_avatar', 'unit.grave_rat'));
    const again = stepBattle(data, result.finalState);
    expect(again.state).toBe(result.finalState);
    expect(again.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('event log', () => {
  const result = runBattle(data, MIXED);

  it('opens with battleStart and closes with battleEnd', () => {
    expect(result.events[0]?.kind).toBe('battleStart');
    const endings = pick(result.events, 'battleEnd');
    expect(endings).toHaveLength(1);
    expect(result.events[result.events.length - 1]).toBe(endings[0]);
    expect(endings[0]?.outcome).toBe(result.outcome);
    expect(endings[0]?.reason).toBe(result.reason);
  });

  it('is ordered by tick and stays inside the battle', () => {
    let previous = 0;
    for (const event of result.events) {
      expect(event.tick).toBeGreaterThanOrEqual(previous);
      expect(event.tick).toBeLessThanOrEqual(result.ticks);
      previous = event.tick;
    }
  });

  it('never references a unit before it has spawned', () => {
    const spawned = new Set<number>();
    const referenced = (event: BattleEvent): number[] => {
      switch (event.kind) {
        case 'spawn':
          return [];
        case 'move':
        case 'death':
          return [event.instanceId];
        case 'attack':
          return [event.instanceId, event.targetId];
        case 'ability':
          return [event.instanceId, ...event.targetIds];
        case 'damage':
        case 'heal':
        case 'shield':
        case 'statMod':
        case 'status':
          return [event.targetId];
        case 'synergyApplied':
          return [...event.affectedIds];
        default:
          return [];
      }
    };

    for (const event of result.events) {
      for (const id of referenced(event)) {
        expect(spawned.has(id), `event ${event.kind} referenced unit ${id}`).toBe(true);
      }
      if (event.kind === 'spawn') spawned.add(event.instanceId);
    }
  });

  it('carries enough to reconstruct the final board without the simulation', () => {
    // This is the contract the renderer depends on: replaying the log alone
    // must reproduce where everyone ended up and how much life they had.
    interface Reconstructed {
      col: number;
      row: number;
      hp: number;
      maxHp: number;
      alive: boolean;
    }
    const board = new Map<number, Reconstructed>();

    for (const event of result.events) {
      switch (event.kind) {
        case 'spawn':
          board.set(event.instanceId, {
            col: event.col,
            row: event.row,
            hp: event.hp,
            maxHp: event.maxHp,
            alive: true,
          });
          break;
        case 'move': {
          const unit = board.get(event.instanceId);
          if (unit !== undefined) {
            unit.col = event.toCol;
            unit.row = event.toRow;
          }
          break;
        }
        case 'damage':
        case 'heal': {
          const unit = board.get(event.targetId);
          if (unit !== undefined) unit.hp = event.hpAfter;
          break;
        }
        case 'statMod': {
          const unit = board.get(event.targetId);
          if (unit !== undefined) {
            unit.hp = event.hpAfter;
            unit.maxHp = event.maxHpAfter;
          }
          break;
        }
        case 'death': {
          const unit = board.get(event.instanceId);
          if (unit !== undefined) {
            unit.alive = false;
            unit.hp = 0;
          }
          break;
        }
        default:
          break;
      }
    }

    expect(board.size).toBe(result.finalState.units.length);
    for (const actual of result.finalState.units) {
      const replayed = board.get(actual.instanceId);
      expect(replayed, `unit ${actual.instanceId} missing from the log`).toBeDefined();
      expect(replayed?.alive).toBe(actual.alive);
      expect(replayed?.col).toBe(actual.col);
      expect(replayed?.row).toBe(actual.row);
      expect(replayed?.hp).toBeCloseTo(actual.hp, 6);
      expect(replayed?.maxHp).toBeCloseTo(actual.maxHp, 6);
    }
  });

  it('pairs every attack with its damage on the same tick', () => {
    const damages = pick(result.events, 'damage');
    for (const event of pick(result.events, 'attack')) {
      const damage = damages.find(
        (candidate) =>
          candidate.tick === event.tick &&
          candidate.sourceId === event.instanceId &&
          candidate.targetId === event.targetId &&
          candidate.source === 'attack',
      );
      expect(damage, `attack on tick ${event.tick} produced no damage`).toBeDefined();
    }
  });

  it('reports each ability before the effects it caused', () => {
    const abilityIndex = result.events.findIndex((event) => event.kind === 'ability');
    expect(abilityIndex).toBeGreaterThan(-1);
    const ability = result.events[abilityIndex];
    const next = result.events[abilityIndex + 1];
    expect(ability?.kind).toBe('ability');
    expect(next?.tick).toBe(ability?.tick);
  });
});

// ---------------------------------------------------------------------------

describe('setup validation', () => {
  it('rejects a unit deployed on the opponent half', () => {
    expect(() =>
      createBattle(data, {
        seed: 1,
        player: [p('unit.grave_rat', 0, 0)],
        enemy: [e('unit.grave_rat', 2, 0)],
      }),
    ).toThrow('deploys on rows 2 and 3');
  });

  it('rejects a cell off the board', () => {
    expect(() =>
      createBattle(data, {
        seed: 1,
        player: [p('unit.grave_rat', 9, 3)],
        enemy: [e('unit.grave_rat', 2, 0)],
      }),
    ).toThrow('off a 5x4 board');
  });

  it('rejects two units stacked on one cell', () => {
    expect(() =>
      createBattle(data, {
        seed: 1,
        player: [p('unit.grave_rat', 1, 3), p('unit.dire_pup', 1, 3)],
        enemy: [e('unit.grave_rat', 2, 0)],
      }),
    ).toThrow('already occupied');
  });

  it('rejects an unknown unit', () => {
    expect(() =>
      createBattle(data, {
        seed: 1,
        player: [p('unit.ghost', 1, 3)],
        enemy: [e('unit.grave_rat', 2, 0)],
      }),
    ).toThrow('no such unit');
  });
});

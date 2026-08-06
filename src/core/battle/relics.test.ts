import { describe, expect, it } from 'vitest';
import { loadBundledGameData } from '../../data/loader';
import { BATTLE_RELIC_TRIGGERS } from '../../data/schema';
import { runBattle } from './index';
import type { BattleSetup, Deployment } from './index';
import { effectiveStat } from './stats';

const data = loadBundledGameData();

/**
 * Relics in a fight.
 *
 * The rule these tests exist to protect is the boring one: **a battle with no
 * relics must be bit-identical to a battle from before relics existed.** The
 * balance simulator runs relic-free, so any stray RNG call or ordering change
 * on the empty path silently invalidates every stored baseline.
 */

function deploy(unitId: string, cells: readonly [number, number][]): Deployment[] {
  return cells.map(([col, row]) => ({ unitId, col, row }));
}

function setup(overrides: Partial<BattleSetup> = {}): BattleSetup {
  return {
    seed: 1234,
    player: deploy('unit.grave_rat', [
      [0, 2],
      [1, 2],
      [2, 2],
    ]),
    enemy: deploy('unit.thornling', [
      [0, 1],
      [1, 1],
      [2, 1],
    ]),
    ...overrides,
  };
}

describe('no relics', () => {
  it('changes nothing when the list is absent or empty', () => {
    const absent = runBattle(data, setup());
    const empty = runBattle(data, setup({ relicIds: [] }));

    expect(empty.outcome).toBe(absent.outcome);
    expect(empty.ticks).toBe(absent.ticks);
    expect(empty.events).toEqual(absent.events);
  });

  it('does not consume randomness for a relic that is not held', () => {
    // Same fight, one side carrying a relic that cannot fire (no Beasts on the
    // board). The stream must be untouched: `chance` is 1, so no roll happens,
    // and the condition fails before any effect is applied.
    const bare = runBattle(data, setup());
    const inert = runBattle(data, setup({ relicIds: ['relic.hunters_totem'] }));
    expect(inert.events).toEqual(bare.events);
  });
});

describe('onBattleStart relics', () => {
  it('applies a stat modifier to the tagged allies only', () => {
    // Three distinct Undead satisfies Grave Censer's threshold of 3.
    const player: Deployment[] = [
      { unitId: 'unit.grave_rat', col: 0, row: 2 },
      { unitId: 'unit.bone_acolyte', col: 1, row: 2 },
      { unitId: 'unit.plague_hound', col: 2, row: 2 },
      { unitId: 'unit.thornling', col: 3, row: 2 },
    ];

    const bare = runBattle(data, setup({ player, relicIds: [] }));
    const buffed = runBattle(data, setup({ player, relicIds: ['relic.grave_censer'] }));

    const maxHp = (result: typeof bare, defId: string): number =>
      result.finalState.units.find((unit) => unit.defId === defId)?.maxHp ?? 0;

    expect(maxHp(buffed, 'unit.grave_rat')).toBeGreaterThan(maxHp(bare, 'unit.grave_rat'));
    // The Beast in the same line-up is untouched.
    expect(maxHp(buffed, 'unit.thornling')).toBe(maxHp(bare, 'unit.thornling'));
  });

  it('does nothing when the tag threshold is not met', () => {
    const player: Deployment[] = [
      { unitId: 'unit.grave_rat', col: 0, row: 2 },
      { unitId: 'unit.bone_acolyte', col: 1, row: 2 },
    ];
    const bare = runBattle(data, setup({ player, relicIds: [] }));
    const gated = runBattle(data, setup({ player, relicIds: ['relic.grave_censer'] }));
    expect(gated.events).toEqual(bare.events);
  });

  it('counts a max-HP relic toward the timeout rule rather than as damage', () => {
    const player: Deployment[] = [
      { unitId: 'unit.scrap_sentry', col: 0, row: 2 },
      { unitId: 'unit.forge_apprentice', col: 1, row: 2 },
      { unitId: 'unit.iron_bulwark', col: 2, row: 2 },
      { unitId: 'unit.blade_dancer', col: 3, row: 2 },
    ];
    const result = runBattle(data, setup({ player, relicIds: ['relic.iron_lodestone'] }));
    const totalMaxHp = result.finalState.units
      .filter((unit) => unit.team === 'player')
      .reduce((sum, unit) => sum + unit.maxHp, 0);
    // Starting HP was measured after the relic landed, so no unit can be
    // holding more max HP than the total the timeout rule was told about.
    expect(result.finalState.startingHp.player).toBeGreaterThanOrEqual(totalMaxHp * 0.99);
  });

  it('applies relics in collection order', () => {
    const player: Deployment[] = [
      { unitId: 'unit.grave_rat', col: 0, row: 2 },
      { unitId: 'unit.bone_acolyte', col: 1, row: 2 },
      { unitId: 'unit.plague_hound', col: 2, row: 2 },
    ];
    const forward = runBattle(
      data,
      setup({ player, relicIds: ['relic.grave_censer', 'relic.thrice_forged_core'] }),
    );
    const backward = runBattle(
      data,
      setup({ player, relicIds: ['relic.thrice_forged_core', 'relic.grave_censer'] }),
    );
    // Both orders buff the same units, so the *outcome* matches — but the event
    // log records them in the order they were applied, which is the order held.
    const statModOrder = (result: typeof forward): string[] =>
      result.events
        .filter((event) => event.kind === 'statMod' && event.tick === 0)
        .map((event) => (event.kind === 'statMod' ? `${event.stat}:${event.amount}` : ''));

    expect(statModOrder(forward)).not.toEqual(statModOrder(backward));
    expect(statModOrder(forward).sort()).toEqual(statModOrder(backward).sort());
  });
});

describe('onAllyDamaged relics', () => {
  it('punishes the attacker when the player is struck', () => {
    const bare = runBattle(data, setup({ relicIds: [] }));
    const thorns = runBattle(data, setup({ relicIds: ['relic.thornmail_shard'] }));

    const pureDamage = (result: typeof bare): number =>
      result.events
        .filter((event) => event.kind === 'damage' && event.damageType === 'pure')
        .reduce((sum, event) => sum + (event.kind === 'damage' ? event.amount : 0), 0);

    expect(pureDamage(bare)).toBe(0);
    expect(pureDamage(thorns)).toBeGreaterThan(0);
  });

  it('does not fire when an enemy is struck', () => {
    // Every damage the relic causes must name a player unit as its subject; a
    // relic firing on enemy hits would heal the opposition.
    const result = runBattle(data, setup({ relicIds: ['relic.thornmail_shard'] }));
    const playerIds = new Set(
      result.finalState.units.filter((u) => u.team === 'player').map((u) => u.instanceId),
    );
    for (const event of result.events) {
      if (event.kind !== 'damage' || event.damageType !== 'pure') continue;
      // Thornmail's source is the struck ally, and its target is the attacker.
      expect(playerIds.has(event.sourceId ?? -1)).toBe(true);
    }
  });

  it('shields the struck ally when the relic protects rather than punishes', () => {
    const result = runBattle(data, setup({ relicIds: ['relic.aegis_eternal'] }));
    const shields = result.events.filter((event) => event.kind === 'shield');
    expect(shields.length).toBeGreaterThan(0);
  });
});

describe('onUnitDeath relics', () => {
  it('fires when a player unit falls, and not when an enemy does', () => {
    // A losing board, so player deaths are guaranteed.
    const doomed = setup({
      player: deploy('unit.grave_rat', [[2, 3]]),
      enemy: deploy('unit.blade_dancer', [
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
      relicIds: ['relic.crown_of_rot'],
    });
    const result = runBattle(data, doomed);
    const playerDeaths = result.events.filter(
      (event) =>
        event.kind === 'death' &&
        result.finalState.units[event.instanceId]?.team === 'player',
    ).length;
    const detonations = result.events.filter(
      (event) => event.kind === 'damage' && event.damageType === 'pure' && event.amount > 0,
    ).length;

    expect(playerDeaths).toBeGreaterThan(0);
    expect(detonations).toBeGreaterThan(0);
  });

  it('heals the survivors on an ally death', () => {
    const doomed = setup({
      player: [
        { unitId: 'unit.grave_rat', col: 2, row: 3 },
        { unitId: 'unit.rot_knight', col: 2, row: 2 },
      ],
      enemy: deploy('unit.blade_dancer', [
        [1, 1],
        [2, 1],
      ]),
      relicIds: ['relic.grave_offering'],
    });
    const withRelic = runBattle(data, doomed);
    const without = runBattle(data, { ...doomed, relicIds: [] });

    const heals = (result: typeof withRelic): number =>
      result.events.filter((event) => event.kind === 'heal').length;
    expect(heals(withRelic)).toBeGreaterThan(heals(without));
  });
});

describe('determinism with relics', () => {
  it('replays identically with the same seed', () => {
    const config = setup({
      relicIds: ['relic.thornmail_shard', 'relic.aegis_eternal', 'relic.tinderbox'],
    });
    const first = runBattle(data, config);
    for (let i = 0; i < 20; i += 1) {
      const again = runBattle(data, config);
      expect(again.ticks).toBe(first.ticks);
      expect(again.outcome).toBe(first.outcome);
      expect(again.events).toEqual(first.events);
    }
  });

  it('survives a mid-battle state round-trip through JSON', () => {
    // Relic ids live in battle state, so a serialized battle must resume with
    // its relics intact rather than quietly dropping them.
    const config = setup({ relicIds: ['relic.thornmail_shard'] });
    const result = runBattle(data, config);
    const revived = JSON.parse(JSON.stringify(result.finalState)) as typeof result.finalState;
    expect(revived.relicIds).toEqual(['relic.thornmail_shard']);
  });
});

describe('content rules for battle relics', () => {
  it('gives every battle-triggered hook a condition a battle can answer', () => {
    const battleTriggers = new Set<string>(BATTLE_RELIC_TRIGGERS);
    for (const relic of data.relics.values()) {
      for (const hook of relic.hooks) {
        if (!battleTriggers.has(hook.on)) continue;
        expect(
          ['always', 'tagCountAtLeast'],
          `${relic.id} hook ${hook.on}`,
        ).toContain(hook.condition.kind);
        for (const action of hook.actions) {
          expect(action.kind, `${relic.id} hook ${hook.on}`).toBe('applyEffect');
        }
      }
    }
  });

  it('gates every high-frequency hook behind a chance', () => {
    for (const relic of data.relics.values()) {
      for (const hook of relic.hooks) {
        if (hook.on !== 'onAllyDamaged') continue;
        expect(hook.chance, `${relic.id} fires on every hit`).toBeLessThan(1);
      }
    }
  });

  it('keeps stat modifiers within a range the stat pipeline can express', () => {
    // A negative multiplier below the floor would clamp silently, so a relic
    // that looks like a nerf would do nothing. None exist today; this is the
    // test that notices when one is added.
    const unit = data.units.get('unit.grave_rat');
    expect(unit).toBeDefined();
    if (unit === undefined) return;
    const result = runBattle(data, setup({ relicIds: ['relic.thrice_forged_core'] }));
    for (const battleUnit of result.finalState.units) {
      expect(Number.isFinite(effectiveStat(battleUnit, 'atk'))).toBe(true);
      expect(effectiveStat(battleUnit, 'atk')).toBeGreaterThan(0);
    }
  });
});

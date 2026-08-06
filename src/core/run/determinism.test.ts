import { describe, expect, it } from 'vitest';
import { loadBundledGameData } from '../../data/loader';
import { runBattle } from '../battle/index';
import {
  battleSetupFor,
  buyUnit,
  deserializeRun,
  firstFreeCell,
  resolveBattle,
  rollRewards,
  rollShop,
  serializeRun,
  startBattle,
  startRun,
  streamSeed,
  tagsOf,
  weightOf,
} from './index';
import type { BoardSlot, RunActionResult, RunState } from './index';

const data = loadBundledGameData();
const rules = data.run.rules;

/**
 * The promise a shared seed makes.
 *
 * Not "the same run if you play the same", which any RNG gives you, but "the
 * same shop in round 9 regardless of what happened in rounds 1 through 8".
 * That is only true because streams are labelled rather than sequential — see
 * `streams.ts` — and it is what a daily challenge is built on, so it gets the
 * hardest tests in this folder.
 */
describe('seed reproducibility', () => {
  it('gives the same opening state for the same seed', () => {
    for (const seed of [0, 1, 42, 9999, 0xdead_beef]) {
      expect(startRun(data, seed)).toEqual(startRun(data, seed));
    }
  });

  it('gives different openings for different seeds', () => {
    const shops = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        startRun(data, seed)
          .shop.map((slot) => slot.unitId)
          .join(),
      ),
    );
    expect(shops.size).toBeGreaterThan(5);
  });

  it('rolls a round from the seed alone, not from what came before it', () => {
    // The same round rolled from two unrelated histories must be identical.
    const seed = 555;
    const untouched = rollShop(data, seed, 9, 0, [], new Map());
    const afterChaos = rollShop(data, seed, 9, 0, [], new Map());
    expect(afterChaos).toEqual(untouched);

    // And a different round on the same seed must not be the same shop.
    const other = rollShop(data, seed, 4, 0, [], new Map());
    expect(other.map((s) => s.unitId).join()).not.toBe(
      untouched.map((s) => s.unitId).join(),
    );
  });

  it('gives each reroll its own shop, repeatably', () => {
    const seed = 4711;
    const rolls = [0, 1, 2, 3].map((roll) =>
      rollShop(data, seed, 5, roll, [], new Map())
        .map((slot) => slot.unitId)
        .join(),
    );
    expect(new Set(rolls).size).toBe(rolls.length);
    for (const roll of [0, 1, 2, 3]) {
      expect(rollShop(data, seed, 5, roll, [], new Map()).map((s) => s.unitId).join()).toBe(
        rolls[roll],
      );
    }
  });

  it('derives an independent battle seed per round', () => {
    const seeds = new Set(
      Array.from({ length: rules.rounds }, (_, i) =>
        streamSeed(2024, { kind: 'battle', round: i + 1 }),
      ),
    );
    expect(seeds.size).toBe(rules.rounds);
  });

  it('keeps shop, reward and battle streams apart', () => {
    const seed = 8080;
    const shop = streamSeed(seed, { kind: 'shop', round: 3, roll: 0 });
    const reward = streamSeed(seed, { kind: 'reward', round: 3 });
    const battle = streamSeed(seed, { kind: 'battle', round: 3 });
    expect(new Set([shop, reward, battle]).size).toBe(3);
  });

  it('replays a whole round identically from the same state', () => {
    const state = ok(buyUnit(data, startRun(data, 606_060), 0));
    const fought = ok(startBattle(state));
    const setup = battleSetupFor(data, fought);

    const first = runBattle(data, setup);
    const second = runBattle(data, setup);
    expect(second.outcome).toBe(first.outcome);
    expect(second.ticks).toBe(first.ticks);
    expect(second.events.length).toBe(first.events.length);

    expect(resolveBattle(data, fought, second)).toEqual(
      resolveBattle(data, fought, first),
    );
  });

  it('offers the same rewards for the same seed, round and board', () => {
    const board: BoardSlot[] = [
      { col: 0, row: 2, unitId: 'unit.grave_rat' },
      { col: 1, row: 2, unitId: 'unit.bone_acolyte' },
    ];
    for (const seed of [7, 77, 777]) {
      expect(rollRewards(data, seed, 5, board, [])).toEqual(
        rollRewards(data, seed, 5, board, []),
      );
    }
  });
});

describe('reward weighting', () => {
  const undeadBoard: BoardSlot[] = [
    { col: 0, row: 2, unitId: 'unit.grave_rat' },
    { col: 1, row: 2, unitId: 'unit.bone_acolyte' },
    { col: 2, row: 2, unitId: 'unit.plague_hound' },
    { col: 3, row: 2, unitId: 'unit.rot_knight' },
  ];

  it('reads a relic’s tags off its own hooks', () => {
    const censer = data.relics.get('relic.grave_censer');
    expect(censer).toBeDefined();
    if (censer === undefined) return;
    expect([...tagsOf(censer)]).toEqual(['Undead']);

    const coin = data.relics.get('relic.brass_coin');
    expect(coin).toBeDefined();
    if (coin === undefined) return;
    expect([...tagsOf(coin)]).toEqual([]);
  });

  it('weights a matching relic above a mismatched one of the same rarity', () => {
    const undead = data.relics.get('relic.grave_censer');
    const beast = data.relics.get('relic.hunters_totem');
    expect(undead).toBeDefined();
    expect(beast).toBeDefined();
    if (undead === undefined || beast === undefined) return;

    expect(weightOf(data, undead, 5, undeadBoard)).toBeGreaterThan(
      weightOf(data, beast, 5, undeadBoard),
    );
  });

  it('gives an untagged relic the same weight on any board', () => {
    const coin = data.relics.get('relic.brass_coin');
    expect(coin).toBeDefined();
    if (coin === undefined) return;
    expect(weightOf(data, coin, 5, undeadBoard)).toBe(weightOf(data, coin, 5, []));
  });

  it('never offers a rarity before it unlocks', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      for (const relicId of rollRewards(data, seed, 1, undeadBoard, [])) {
        const relic = data.relics.get(relicId);
        const entry = data.run.rarityWeights.find((row) => row.rarity === relic?.rarity);
        expect(entry?.minRound, `${relicId} at round 1`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never offers a duplicate, in a slot or against what is owned', () => {
    const owned = ['relic.brass_coin', 'relic.grave_censer'];
    for (let seed = 0; seed < 200; seed += 1) {
      const offer = rollRewards(data, seed, 8, undeadBoard, owned);
      expect(new Set(offer).size, `seed ${seed}`).toBe(offer.length);
      for (const id of offer) expect(owned).not.toContain(id);
    }
  });

  it('leaks off-plan relics at roughly the configured rate', () => {
    // The weighted draw can still pick a mismatched relic, so this measures the
    // floor, not the exact share: with the leak switched off, a heavily-tagged
    // board would see far fewer of them.
    let offTag = 0;
    let total = 0;
    for (let seed = 0; seed < 600; seed += 1) {
      for (const relicId of rollRewards(data, seed, 8, undeadBoard, [])) {
        const relic = data.relics.get(relicId);
        if (relic === undefined) continue;
        total += 1;
        const tags = tagsOf(relic);
        if (tags.size > 0 && !tags.has('Undead')) offTag += 1;
      }
    }
    expect(total).toBeGreaterThan(0);
    const share = offTag / total;
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.6);
  });

  it('offers a short menu rather than padding when the pool runs dry', () => {
    const owned = [...data.relics.keys()].slice(0, data.relics.size - 2);
    const offer = rollRewards(data, 1, 8, undeadBoard, owned);
    expect(offer).toHaveLength(2);
  });
});

describe('save and resume', () => {
  it('round-trips a fresh run', () => {
    const state = startRun(data, 20_260_806);
    const loaded = deserializeRun(serializeRun(state), data);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state).toEqual(state);
  });

  it('round-trips a run mid-reward with relics and history', () => {
    const state = playTo(startRun(data, 4004), 'reward');
    if (state === null) return;
    const loaded = deserializeRun(serializeRun(state), data);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state).toEqual(state);
  });

  it('resumes to exactly the same next state', () => {
    const state = ok(buyUnit(data, startRun(data, 31_415), 0));
    const loaded = deserializeRun(serializeRun(state), data);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const direct = ok(buyUnit(data, state, 1));
    const resumed = ok(buyUnit(data, loaded.state, 1));
    expect(resumed).toEqual(direct);
  });

  it('rejects a save from another version', () => {
    const state = startRun(data, 1);
    const raw = serializeRun({ ...state, saveVersion: 99 });
    const loaded = deserializeRun(raw, data);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('version 99');
  });

  it.each([
    ['not JSON at all', '{oh no'],
    ['an array', '[]'],
    ['an empty object', '{}'],
  ])('rejects %s', (_label, raw) => {
    expect(deserializeRun(raw, data).ok).toBe(false);
  });

  it('rejects a save naming content this build does not ship', () => {
    const state = startRun(data, 1);
    const raw = serializeRun({ ...state, relicIds: ['relic.does_not_exist'] });
    const loaded = deserializeRun(raw, data);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('no longer exists');
  });

  it('rejects a board with two units on one cell', () => {
    const state = startRun(data, 1);
    const raw = serializeRun({
      ...state,
      board: [
        { col: 0, row: 2, unitId: 'unit.grave_rat' },
        { col: 0, row: 2, unitId: 'unit.thornling' },
      ],
    });
    expect(deserializeRun(raw, data).ok).toBe(false);
  });

  it('rejects a board unit on the enemy half', () => {
    const state = startRun(data, 1);
    const raw = serializeRun({
      ...state,
      board: [{ col: 0, row: 0, unitId: 'unit.grave_rat' }],
    });
    expect(deserializeRun(raw, data).ok).toBe(false);
  });

  it('rejects an incoherent save that would strand the player', () => {
    const state = startRun(data, 1);
    const stranded = serializeRun({ ...state, phase: 'reward', rewardOffer: [] });
    const loaded = deserializeRun(stranded, data);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.reason).toContain('reward phase');

    const zombie = serializeRun({ ...state, lives: 0 });
    expect(deserializeRun(zombie, data).ok).toBe(false);
  });
});

// --- helpers ----------------------------------------------------------------

function ok(result: RunActionResult): RunState {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.state;
}

/** Plays a strong board through round 1 to reach the reward phase. */
function playTo(start: RunState, phase: 'reward'): RunState | null {
  const unit = [...data.units.values()]
    .filter((u) => u.tier === 1)
    .sort((a, b) => b.stats.hp * b.stats.atk - a.stats.hp * a.stats.atk)[0];
  if (unit === undefined) return null;

  let board = start.board;
  for (let i = 0; i < 6; i += 1) {
    const cell = firstFreeCell(board);
    if (cell === null) break;
    board = [...board, { col: cell.col, row: cell.row, unitId: unit.id }];
  }

  const staged = ok(startBattle({ ...start, board }));
  const resolved = resolveBattle(data, staged, runBattle(data, battleSetupFor(data, staged)));
  return resolved.phase === phase ? resolved : null;
}

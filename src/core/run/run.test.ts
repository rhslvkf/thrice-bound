import { describe, expect, it } from 'vitest';
import { loadBundledGameData } from '../../data/loader';
import { MERGE_COST_IN_COPIES } from '../../data/schema';
import { runBattle } from '../battle/index';
import {
  BOARD_CAPACITY,
  battleSetupFor,
  buyUnit,
  chooseReward,
  encounterFor,
  enterPrep,
  firstFreeCell,
  incomeFor,
  mergeOpportunities,
  mergeUnits,
  moveUnit,
  rerollCost,
  rerollShop,
  resolveBattle,
  sellUnit,
  sellValue,
  skipReward,
  startBattle,
  startRun,
  toggleLock,
  unitAt,
} from './index';
import type { RunActionResult, RunState } from './index';

const data = loadBundledGameData();
const rules = data.run.rules;

/** Unwraps an action, failing the test with the refusal reason if it refused. */
function ok(result: RunActionResult): RunState {
  if (!result.ok) throw new Error(`expected success, got refusal: ${result.reason}`);
  return result.state;
}

function refusal(result: RunActionResult): string {
  if (result.ok) throw new Error('expected a refusal, got success');
  return result.reason;
}

describe('run lifecycle', () => {
  it('starts in the shop of round 1 with a full shop and a full purse', () => {
    const state = startRun(data, 1234);
    expect(state.round).toBe(1);
    expect(state.phase).toBe('shop');
    expect(state.lives).toBe(rules.startingLives);
    expect(state.shop).toHaveLength(rules.shopSlots);
    expect(state.board).toEqual([]);
    expect(state.relicIds).toEqual([]);
    expect(state.result).toBeNull();
    // Starting gold plus round 1 income.
    expect(state.gold).toBe(rules.startingGold + incomeFor(data, 1, rules.startingGold));
  });

  it('stocks the shop with tier 1 only in the opening rounds', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const state = startRun(data, seed);
      for (const slot of state.shop) {
        if (slot.unitId === null) continue;
        expect(data.units.get(slot.unitId)?.tier, `seed ${seed}`).toBe(1);
      }
    }
  });

  it('refuses to fight with an empty board', () => {
    expect(refusal(startBattle(startRun(data, 7)))).toContain('deploy at least one');
  });
});

describe('shop', () => {
  it('buys a unit onto the board and charges for it', () => {
    const before = startRun(data, 99);
    const slot = before.shop[0];
    expect(slot?.unitId).toBeTruthy();
    if (slot?.unitId === undefined || slot.unitId === null) return;

    const price = data.units.get(slot.unitId)?.cost ?? 0;
    const after = ok(buyUnit(data, before, 0));

    expect(after.gold).toBe(before.gold - price);
    expect(after.board).toHaveLength(1);
    expect(after.board[0]?.unitId).toBe(slot.unitId);
    expect(after.shop[0]?.unitId).toBeNull();
  });

  it('refuses a purchase it cannot afford', () => {
    const state: RunState = { ...startRun(data, 5), gold: 0 };
    expect(refusal(buyUnit(data, state, 0))).toContain('gold');
  });

  it('refuses a purchase when the board is full', () => {
    let state = startRun(data, 5);
    // Fill every cell directly; buying ten would need more gold than round 1 has.
    const filler = [...data.units.values()][0];
    expect(filler).toBeDefined();
    if (filler === undefined) return;

    let board = state.board;
    for (let i = 0; i < BOARD_CAPACITY; i += 1) {
      const cell = firstFreeCell(board);
      expect(cell).not.toBeNull();
      if (cell === null) break;
      board = [...board, { col: cell.col, row: cell.row, unitId: filler.id }];
    }
    state = { ...state, board, gold: 999 };
    expect(refusal(buyUnit(data, state, 0))).toContain('full');
  });

  it('charges for a reroll and produces a different shop', () => {
    const before = startRun(data, 4242);
    const after = ok(rerollShop(data, before));
    expect(after.gold).toBe(before.gold - rules.rerollCost);
    expect(after.rerolls).toBe(1);
    // Not a guarantee for any single seed, but across a batch it must differ.
    const differed = [0, 1, 2, 3, 4, 5, 6, 7].filter((seed) => {
      const a = startRun(data, seed);
      const b = ok(rerollShop(data, a));
      return a.shop.map((s) => s.unitId).join() !== b.shop.map((s) => s.unitId).join();
    });
    expect(differed.length).toBeGreaterThan(5);
  });

  it('refuses a reroll with no gold', () => {
    const state: RunState = { ...startRun(data, 5), gold: 0, freeRerolls: 0 };
    expect(refusal(rerollShop(data, state))).toContain('reroll costs');
  });

  it('spends free rerolls before gold', () => {
    const state: RunState = { ...startRun(data, 5), freeRerolls: 2 };
    expect(rerollCost(data, state)).toBe(0);
    const after = ok(rerollShop(data, state));
    expect(after.gold).toBe(state.gold);
    expect(after.freeRerolls).toBe(1);
  });

  it('keeps locked slots across a reroll', () => {
    const before = ok(toggleLock(startRun(data, 808), 2));
    const held = before.shop[2]?.unitId;
    expect(before.shop[2]?.locked).toBe(true);

    const after = ok(rerollShop(data, before));
    expect(after.shop[2]?.unitId).toBe(held);
    expect(after.shop[2]?.locked).toBe(true);
  });

  it('does not let a lock shift what the other slots roll', () => {
    // The roll for a locked slot still happens and is discarded, so two players
    // on the same seed see the same shop whether or not one of them locked.
    const plain = ok(rerollShop(data, startRun(data, 31337)));
    const locked = ok(rerollShop(data, ok(toggleLock(startRun(data, 31337), 1))));
    for (let i = 0; i < plain.shop.length; i += 1) {
      if (i === 1) continue;
      expect(locked.shop[i]?.unitId, `slot ${i}`).toBe(plain.shop[i]?.unitId);
    }
  });

  it('sells a board unit back for a fraction of its cost', () => {
    const bought = ok(buyUnit(data, startRun(data, 77), 0));
    const slot = bought.board[0];
    expect(slot).toBeDefined();
    if (slot === undefined) return;

    const after = ok(sellUnit(data, bought, slot));
    expect(after.gold).toBe(bought.gold + sellValue(data, slot.unitId));
    expect(after.board).toHaveLength(0);
  });
});

describe('board', () => {
  it('swaps two cells', () => {
    let state = ok(buyUnit(data, startRun(data, 2001), 0));
    state = ok(buyUnit(data, state, 1));
    const [a, b] = state.board;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;

    const after = ok(moveUnit(state, a, b));
    expect(unitAt(after.board, a.col, a.row)).toBe(b.unitId);
    expect(unitAt(after.board, b.col, b.row)).toBe(a.unitId);
  });

  it('refuses to move from an empty cell', () => {
    const state = startRun(data, 3);
    expect(refusal(moveUnit(state, { col: 0, row: 2 }, { col: 1, row: 2 }))).toContain(
      'nothing to move',
    );
  });
});

describe('merging', () => {
  /** Puts three copies of a mergeable tier 1 unit on the board. */
  function withThree(seed: number): { state: RunState; unitId: string } {
    const base = startRun(data, seed);
    const unit = [...data.units.values()].find(
      (u) => u.tier === 1 && u.mergesInto.length >= 2,
    );
    if (unit === undefined) throw new Error('no mergeable tier 1 unit in the roster');

    let board = base.board;
    for (let i = 0; i < MERGE_COST_IN_COPIES; i += 1) {
      const cell = firstFreeCell(board);
      if (cell === null) break;
      board = [...board, { col: cell.col, row: cell.row, unitId: unit.id }];
    }
    return { state: { ...base, board }, unitId: unit.id };
  }

  it('offers a merge once three copies are down, and not before', () => {
    const { state, unitId } = withThree(11);
    expect(mergeOpportunities(data, state.board).map((o) => o.unitId)).toEqual([unitId]);

    const two: RunState = { ...state, board: state.board.slice(0, 2) };
    expect(mergeOpportunities(data, two.board)).toEqual([]);
  });

  it('consumes the copies and leaves the chosen upgrade', () => {
    const { state, unitId } = withThree(12);
    const option = mergeOpportunities(data, state.board)[0]?.options[0];
    expect(option).toBeDefined();
    if (option === undefined) return;

    const after = ok(mergeUnits(data, state, unitId, option.id));
    expect(after.board).toHaveLength(1);
    expect(after.board[0]?.unitId).toBe(option.id);
    expect(data.units.get(option.id)?.tier).toBe(2);
  });

  it('refuses an upgrade the unit does not merge into', () => {
    const { state, unitId } = withThree(13);
    expect(refusal(mergeUnits(data, state, unitId, 'unit.void_sovereign'))).toContain(
      'does not merge into',
    );
  });

  it('refuses a merge with only two copies', () => {
    const { state, unitId } = withThree(14);
    const two: RunState = { ...state, board: state.board.slice(0, 2) };
    expect(refusal(mergeUnits(data, two, unitId, 'unit.bramble_stalker'))).toContain(
      `${MERGE_COST_IN_COPIES} copies`,
    );
  });

  it('pays out onMerge relics', () => {
    const { state, unitId } = withThree(15);
    const withRelic: RunState = { ...state, relicIds: ['relic.scavengers_pouch'] };
    const option = mergeOpportunities(data, state.board)[0]?.options[0];
    if (option === undefined) return;

    const after = ok(mergeUnits(data, withRelic, unitId, option.id));
    expect(after.gold).toBe(withRelic.gold + 2);
  });
});

describe('battle resolution', () => {
  /** Plays one round to a decision with whatever is on the board. */
  function fight(state: RunState): RunState {
    const started = ok(startBattle(state));
    const result = runBattle(data, battleSetupFor(data, started));
    return resolveBattle(data, started, result);
  }

  it('loses one life per surviving enemy', () => {
    // One tier 1 unit against round 1 is a fight it can lose; either way the
    // arithmetic must hold.
    const state = ok(buyUnit(data, startRun(data, 5150), 0));
    const after = fight(state);
    const record = after.history[after.history.length - 1];
    expect(record).toBeDefined();
    if (record === undefined) return;

    if (record.outcome === 'player') {
      expect(record.livesLost).toBe(0);
      expect(after.lives).toBe(state.lives);
    } else {
      expect(record.livesLost).toBe(record.enemySurvivors);
      expect(after.lives).toBe(state.lives - record.enemySurvivors);
    }
  });

  it('ends the run when lives run out', () => {
    const brittle: RunState = { ...ok(buyUnit(data, startRun(data, 606), 0)), lives: 1 };
    const after = fight(brittle);
    if (after.history[0]?.outcome === 'player') return; // won; nothing to assert
    expect(after.phase).toBe('over');
    expect(after.result).toBe('defeat');
    expect(after.lives).toBe(0);
  });

  it('offers three relics after a win and banks the one chosen', () => {
    // Round 1 is two Grave Rats; a full board of tier 1 units clears it.
    const state = stackedBoard(startRun(data, 4004), 6);
    const after = fight(state);
    expect(after.history[0]?.outcome).toBe('player');
    expect(after.phase).toBe('reward');
    expect(after.rewardOffer).toHaveLength(rules.rewardChoices);

    const picked = after.rewardOffer?.[0];
    expect(picked).toBeDefined();
    if (picked === undefined) return;

    const next = ok(chooseReward(data, after, picked));
    expect(next.relicIds).toEqual([picked]);
    expect(next.round).toBe(2);
    expect(next.phase).toBe('shop');
    expect(next.history[0]?.relicId).toBe(picked);
  });

  it('lets a reward be skipped', () => {
    const after = fight(stackedBoard(startRun(data, 4005), 6));
    if (after.phase !== 'reward') return;
    const next = ok(skipReward(data, after));
    expect(next.relicIds).toEqual([]);
    expect(next.round).toBe(2);
  });

  it('refuses a relic that was not offered', () => {
    const after = fight(stackedBoard(startRun(data, 4006), 6));
    if (after.phase !== 'reward') return;
    const notOffered = [...data.relics.keys()].find(
      (id) => !(after.rewardOffer ?? []).includes(id),
    );
    if (notOffered === undefined) return;
    expect(refusal(chooseReward(data, after, notOffered))).toContain('was not offered');
  });

  it('throws when a battle is resolved that was never started', () => {
    const state = ok(buyUnit(data, startRun(data, 1), 0));
    const result = runBattle(data, battleSetupFor(data, state));
    expect(() => resolveBattle(data, state, result)).toThrow(/phase/);
  });
});

/** Fills cells with a strong tier 1 unit, ignoring gold — a test fixture. */
function stackedBoard(state: RunState, count: number): RunState {
  const unit = [...data.units.values()]
    .filter((u) => u.tier === 1)
    .sort((a, b) => b.stats.hp * b.stats.atk - a.stats.hp * a.stats.atk)[0];
  if (unit === undefined) throw new Error('no tier 1 units');

  let board = state.board;
  for (let i = 0; i < count; i += 1) {
    const cell = firstFreeCell(board);
    if (cell === null) break;
    board = [...board, { col: cell.col, row: cell.row, unitId: unit.id }];
  }
  return { ...state, board };
}

describe('phase guards', () => {
  it('refuses a reroll outside the shop', () => {
    const state = ok(enterPrep(startRun(data, 8)));
    expect(refusal(rerollShop(data, state))).toContain('shop is closed');
  });

  it('refuses a second startBattle', () => {
    const state = ok(startBattle(ok(buyUnit(data, startRun(data, 9), 0))));
    expect(refusal(startBattle(state))).toContain('already started');
  });

  it('refuses a reward choice when none is pending', () => {
    expect(refusal(chooseReward(data, startRun(data, 10), 'relic.brass_coin'))).toContain(
      'no reward',
    );
  });
});

describe('encounters', () => {
  it('has one for every round, with the boss flags run.json declares', () => {
    for (let round = 1; round <= rules.rounds; round += 1) {
      const encounter = encounterFor(data, round);
      expect(encounter.round).toBe(round);
      expect(encounter.boss).toBe(rules.bossRounds.includes(round));
    }
  });
});

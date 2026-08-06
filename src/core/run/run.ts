/**
 * The run.
 *
 * Twelve rounds, each of them shop -> prep -> battle -> reward, wrapped in a
 * player health pool that a lost fight eats into. This file is the state
 * machine: every legal action is a function here, every one of them takes a
 * {@link RunState} and returns a new one, and nothing else in the codebase is
 * allowed to construct a run state by hand.
 *
 * Two rules shape the whole file:
 *
 * - **Actions do not throw for ordinary refusals.** A full board, an empty
 *   purse or a merge with two copies are things players attempt constantly.
 *   They come back as {@link RunRefusal} with a reason a UI can show. Throwing
 *   is reserved for a caller doing something incoherent, like resolving a
 *   battle that was never started.
 * - **No wall clock, no `Math.random`, no storage.** A run advances only when
 *   something calls it, and every roll derives from the seed — see
 *   `streams.ts`. That is what lets `src/sim` play thousands of runs headless
 *   and `src/meta` write one to disk mid-round.
 */

import type { EncounterDef, GameData } from '../../data/schema';
import { MERGE_COST_IN_COPIES } from '../../data/schema';
import type { BattleResult, BattleSetup, Deployment } from '../battle/index';
import {
  BOARD_CAPACITY,
  applyMerge,
  firstFreeCell,
  isFull,
  isPlayerCell,
  mergeOpportunities,
  place,
  removeAt,
  swap,
  toDeployments,
  unitAt,
} from './board';
import type { Cell } from './board';
import { activeShopOddsRelics, fireRunHooks } from './relics';
import { rollRewards } from './rewards';
import { priceOf, rollShop, shopOddsFrom } from './shop';
import { streamSeed } from './streams';
import type {
  BoardSlot,
  RunActionResult,
  RunPhase,
  RunState,
  ShopSlot,
} from './types';
import { RUN_SAVE_VERSION, accept, refuse } from './types';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function encounterFor(data: GameData, round: number): EncounterDef {
  const encounter = data.encounters.find((entry) => entry.round === round);
  if (encounter === undefined) {
    throw new Error(`no encounter defined for round ${round}`);
  }
  return encounter;
}

export function isBossRound(data: GameData, round: number): boolean {
  return data.run.rules.bossRounds.includes(round);
}

export function isFinalRound(data: GameData, round: number): boolean {
  return round >= data.run.rules.rounds;
}

/** Cost of the next reroll, after free rerolls are taken into account. */
export function rerollCost(data: GameData, state: RunState): number {
  return state.freeRerolls > 0 ? 0 : data.run.rules.rerollCost;
}

/** What selling a board unit pays back. Always at least 1 for a real unit. */
export function sellValue(data: GameData, unitId: string): number {
  const cost = data.units.get(unitId)?.cost ?? 0;
  if (cost <= 0) return 0;
  return Math.max(1, Math.floor(cost * data.run.rules.sellRefundShare));
}

/**
 * Income at the start of a round: a flat base, a per-round ramp, and interest.
 *
 * Interest is what makes saving a real option against buying now, so it is
 * capped — uncapped interest makes the first four rounds a formality where the
 * correct play is to buy nothing.
 */
export function incomeFor(data: GameData, round: number, gold: number): number {
  const { baseIncome, incomePerRound, interestPerGold, interestCap } = data.run.rules;
  const interest = Math.min(interestCap, Math.floor(gold / interestPerGold));
  return baseIncome + incomePerRound * (round - 1) + interest;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A mutable working copy. Never escapes this module except through `freeze`. */
interface Draft {
  saveVersion: number;
  seed: number;
  round: number;
  phase: RunPhase;
  lives: number;
  gold: number;
  shop: ShopSlot[];
  rerolls: number;
  freeRerolls: number;
  board: BoardSlot[];
  relicIds: string[];
  rewardOffer: string[] | null;
  history: RunState['history'];
  result: RunState['result'];
}

function draft(state: RunState): Draft {
  return {
    saveVersion: state.saveVersion,
    seed: state.seed,
    round: state.round,
    phase: state.phase,
    lives: state.lives,
    gold: state.gold,
    shop: [...state.shop],
    rerolls: state.rerolls,
    freeRerolls: state.freeRerolls,
    board: [...state.board],
    relicIds: [...state.relicIds],
    rewardOffer: state.rewardOffer === null ? null : [...state.rewardOffer],
    history: state.history,
    result: state.result,
  };
}

function freeze(d: Draft): RunState {
  return {
    saveVersion: d.saveVersion,
    seed: d.seed,
    round: d.round,
    phase: d.phase,
    lives: d.lives,
    gold: d.gold,
    shop: d.shop,
    rerolls: d.rerolls,
    freeRerolls: d.freeRerolls,
    board: d.board,
    relicIds: d.relicIds,
    rewardOffer: d.rewardOffer,
    history: d.history,
    result: d.result,
  };
}

/** Rolls this round's shop, honouring locks and relic odds. */
function restock(data: GameData, d: Draft): void {
  const relics = activeShopOddsRelics(data, d.relicIds, {
    round: d.round,
    gold: d.gold,
    board: d.board,
  });
  d.shop = rollShop(
    data,
    d.seed,
    d.round,
    d.rerolls,
    d.shop,
    shopOddsFrom(relics),
  );
}

/**
 * Opens a round: income, `onRoundStart` relics, a fresh shop.
 *
 * Locked slots survive the round boundary, which is why `restock` is handed the
 * previous shop rather than an empty one.
 */
function beginRound(data: GameData, d: Draft): void {
  d.gold += incomeFor(data, d.round, d.gold);
  d.rerolls = 0;
  d.freeRerolls = 0;

  const hooks = fireRunHooks(data, d.seed, 'onRoundStart', d.relicIds, {
    round: d.round,
    gold: d.gold,
    board: d.board,
  });
  d.gold += hooks.gold;
  d.freeRerolls += hooks.freeRerolls;
  d.board = [...hooks.board];

  restock(data, d);
  d.phase = 'shop';
  d.rewardOffer = null;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Begins a run. The seed is the only input; everything else follows from it. */
export function startRun(data: GameData, seed: number): RunState {
  const rules = data.run.rules;
  const d: Draft = {
    saveVersion: RUN_SAVE_VERSION,
    seed: seed >>> 0,
    round: 1,
    phase: 'shop',
    lives: rules.startingLives,
    gold: rules.startingGold,
    shop: [],
    rerolls: 0,
    freeRerolls: 0,
    board: [],
    relicIds: [],
    rewardOffer: null,
    history: [],
    result: null,
  };

  // `onRunStart` fires before the first income, so a relic that opens with gold
  // is spendable in round 1 rather than round 2. Nothing grants relics at run
  // start yet; the hook exists so that content can.
  const opening = fireRunHooks(data, d.seed, 'onRunStart', d.relicIds, {
    round: d.round,
    gold: d.gold,
    board: d.board,
  });
  d.gold += opening.gold;
  d.board = [...opening.board];

  beginRound(data, d);
  return freeze(d);
}

// ---------------------------------------------------------------------------
// Shop phase
// ---------------------------------------------------------------------------

export function rerollShop(data: GameData, state: RunState): RunActionResult {
  if (state.phase !== 'shop') return refuse('the shop is closed');

  const d = draft(state);
  const cost = rerollCost(data, state);
  if (cost > 0 && d.gold < cost) return refuse(`a reroll costs ${cost} gold`);

  if (d.freeRerolls > 0) d.freeRerolls -= 1;
  else d.gold -= cost;

  d.rerolls += 1;
  restock(data, d);

  const hooks = fireRunHooks(data, d.seed, 'onShopReroll', d.relicIds, {
    round: d.round,
    gold: d.gold,
    board: d.board,
  });
  d.gold += hooks.gold;
  d.freeRerolls += hooks.freeRerolls;

  return accept(freeze(d));
}

export function toggleLock(state: RunState, slotIndex: number): RunActionResult {
  if (state.phase !== 'shop') return refuse('the shop is closed');
  const slot = state.shop[slotIndex];
  if (slot === undefined) return refuse(`no shop slot ${slotIndex}`);
  if (slot.unitId === null) return refuse('that slot is empty');

  const shop = [...state.shop];
  shop[slotIndex] = { unitId: slot.unitId, locked: !slot.locked };
  return accept({ ...state, shop });
}

/**
 * Buys a shop slot onto the board.
 *
 * Bought units go straight to the first free cell rather than to a bench. There
 * is no bench in this game: the board holds ten, merges free cells as they
 * resolve, and a second holding area would add a whole management layer to a
 * loop whose interesting decision is the merge, not the storage.
 */
export function buyUnit(
  data: GameData,
  state: RunState,
  slotIndex: number,
): RunActionResult {
  if (state.phase !== 'shop' && state.phase !== 'prep') {
    return refuse('units can only be bought before a fight');
  }
  const slot = state.shop[slotIndex];
  if (slot === undefined) return refuse(`no shop slot ${slotIndex}`);
  if (slot.unitId === null) return refuse('that slot is already bought');

  const price = priceOf(data, slot.unitId);
  if (state.gold < price) return refuse(`that costs ${price} gold`);

  const cell = firstFreeCell(state.board);
  if (cell === null) return refuse(`the board is full (${BOARD_CAPACITY} units)`);

  const d = draft(state);
  d.gold -= price;
  d.board = place(d.board, cell.col, cell.row, slot.unitId);
  d.shop = [...d.shop];
  d.shop[slotIndex] = { unitId: null, locked: false };

  const hooks = fireRunHooks(data, d.seed, 'onUnitPurchase', d.relicIds, {
    round: d.round,
    gold: d.gold,
    board: d.board,
  });
  d.gold += hooks.gold;
  d.freeRerolls += hooks.freeRerolls;
  d.board = [...hooks.board];

  return accept(freeze(d));
}

export function sellUnit(
  data: GameData,
  state: RunState,
  cell: Cell,
): RunActionResult {
  if (state.phase !== 'shop' && state.phase !== 'prep') {
    return refuse('units can only be sold before a fight');
  }
  const unitId = unitAt(state.board, cell.col, cell.row);
  if (unitId === null) return refuse('that cell is empty');

  return accept({
    ...state,
    gold: state.gold + sellValue(data, unitId),
    board: removeAt(state.board, cell.col, cell.row),
  });
}

/** Leaves the shop. Purchases are still allowed in prep; rerolls are not. */
export function enterPrep(state: RunState): RunActionResult {
  if (state.phase !== 'shop') return refuse('not in the shop');
  return accept({ ...state, phase: 'prep' });
}

export function returnToShop(state: RunState): RunActionResult {
  if (state.phase !== 'prep') return refuse('not in prep');
  return accept({ ...state, phase: 'shop' });
}

// ---------------------------------------------------------------------------
// Prep phase
// ---------------------------------------------------------------------------

export function moveUnit(state: RunState, from: Cell, to: Cell): RunActionResult {
  if (state.phase !== 'shop' && state.phase !== 'prep') {
    return refuse('the board is locked once the fight starts');
  }
  if (!isPlayerCell(from.col, from.row) || !isPlayerCell(to.col, to.row)) {
    return refuse('that cell is not on your half of the board');
  }
  if (unitAt(state.board, from.col, from.row) === null) {
    return refuse('there is nothing to move');
  }
  return accept({ ...state, board: swap(state.board, from, to) });
}

/**
 * Merges three copies into one of the unit's upgrade candidates.
 *
 * This does not fire automatically when a third copy lands, and that is the
 * central design decision of the game: the merge *direction* is the choice, and
 * a choice cannot be made for you. The renderer's job is to make the moment
 * loud, not to make it happen.
 */
export function mergeUnits(
  data: GameData,
  state: RunState,
  unitId: string,
  chosenId: string,
): RunActionResult {
  if (state.phase !== 'shop' && state.phase !== 'prep') {
    return refuse('merging is only possible before a fight');
  }

  const opportunity = mergeOpportunities(data, state.board).find(
    (entry) => entry.unitId === unitId,
  );
  if (opportunity === undefined) {
    return refuse(`you need ${MERGE_COST_IN_COPIES} copies to merge`);
  }
  if (!opportunity.options.some((option) => option.id === chosenId)) {
    return refuse(`${unitId} does not merge into ${chosenId}`);
  }

  const d = draft(state);
  const merged = applyMerge(d.board, opportunity, chosenId);
  d.board = merged.board;

  const hooks = fireRunHooks(data, d.seed, 'onMerge', d.relicIds, {
    round: d.round,
    gold: d.gold,
    board: d.board,
  });
  d.gold += hooks.gold;
  d.freeRerolls += hooks.freeRerolls;
  d.board = [...hooks.board];

  return accept(freeze(d));
}

// ---------------------------------------------------------------------------
// Battle phase
// ---------------------------------------------------------------------------

/** The battle the current round is about to run. Pure — changes no state. */
export function battleSetupFor(data: GameData, state: RunState): BattleSetup {
  const encounter = encounterFor(data, state.round);
  const enemy: Deployment[] = encounter.placements.map((placement) => ({
    unitId: placement.unitId,
    col: placement.col,
    row: placement.row,
  }));

  return {
    seed: streamSeed(state.seed, { kind: 'battle', round: state.round }),
    player: toDeployments(state.board),
    enemy,
    relicIds: state.relicIds,
  };
}

/**
 * Commits to the fight.
 *
 * Refused with an empty board: a run that can walk into round 1 with nothing
 * deployed loses instantly for reasons the player will read as a bug.
 */
export function startBattle(state: RunState): RunActionResult {
  if (state.phase !== 'shop' && state.phase !== 'prep') {
    return refuse('the fight has already started');
  }
  if (state.board.length === 0) return refuse('deploy at least one unit');
  return accept({ ...state, phase: 'battle' });
}

/**
 * Settles the fight and moves the run on.
 *
 * A loss costs one life per surviving enemy — the closer the fight, the cheaper
 * it is to lose, so a narrow defeat on round 9 does not end a run outright. A
 * draw is scored as a loss for the same reason it is a draw: the player did not
 * clear the board.
 *
 * @throws {Error} if called outside the battle phase, which would mean the
 *   caller lost track of the run rather than the player doing something odd.
 */
export function resolveBattle(
  data: GameData,
  state: RunState,
  result: BattleResult,
): RunState {
  if (state.phase !== 'battle') {
    throw new Error(`resolveBattle called in phase ${JSON.stringify(state.phase)}`);
  }

  const encounter = encounterFor(data, state.round);
  const won = result.outcome === 'player';
  const enemySurvivors = result.finalState.units.filter(
    (unit) => unit.alive && unit.team === 'enemy',
  ).length;

  const d = draft(state);
  let goldEarned = 0;

  if (won) {
    goldEarned += encounter.goldReward + data.run.rules.winBonusGold;
  }

  const endHooks = fireRunHooks(data, d.seed, 'onBattleEnd', d.relicIds, {
    round: d.round,
    gold: d.gold + goldEarned,
    board: d.board,
  });
  goldEarned += endHooks.gold;
  d.freeRerolls += endHooks.freeRerolls;

  const roundHooks = fireRunHooks(data, d.seed, 'onRoundEnd', d.relicIds, {
    round: d.round,
    gold: d.gold + goldEarned,
    board: d.board,
  });
  goldEarned += roundHooks.gold;
  d.freeRerolls += roundHooks.freeRerolls;

  const livesLost = won ? 0 : enemySurvivors;
  d.gold += goldEarned;
  d.lives -= livesLost;

  const relicOffer =
    won && !isFinalRound(data, d.round)
      ? rollRewards(data, d.seed, d.round, d.board, d.relicIds)
      : [];

  d.history = [
    ...d.history,
    {
      round: d.round,
      encounterId: encounter.id,
      outcome: result.outcome,
      ticks: result.ticks,
      enemySurvivors,
      livesLost,
      goldEarned,
      // Filled in by `chooseReward`; recorded as null until then.
      relicId: null,
    },
  ];

  if (d.lives <= 0) {
    d.lives = 0;
    d.phase = 'over';
    d.result = 'defeat';
    d.rewardOffer = null;
    return freeze(d);
  }

  if (won && isFinalRound(data, d.round)) {
    d.phase = 'over';
    d.result = 'victory';
    d.rewardOffer = null;
    return freeze(d);
  }

  if (relicOffer.length > 0) {
    d.phase = 'reward';
    d.rewardOffer = relicOffer;
    return freeze(d);
  }

  // No reward to choose — a loss, or a pool with nothing unowned left in it.
  advance(data, d);
  return freeze(d);
}

// ---------------------------------------------------------------------------
// Reward phase
// ---------------------------------------------------------------------------

export function chooseReward(
  data: GameData,
  state: RunState,
  relicId: string,
): RunActionResult {
  if (state.phase !== 'reward') return refuse('there is no reward to choose');
  if (state.rewardOffer === null || !state.rewardOffer.includes(relicId)) {
    return refuse(`${relicId} was not offered`);
  }

  const d = draft(state);
  d.relicIds = [...d.relicIds, relicId];
  d.rewardOffer = null;

  const last = d.history[d.history.length - 1];
  if (last !== undefined) {
    d.history = [...d.history.slice(0, -1), { ...last, relicId }];
  }

  advance(data, d);
  return accept(freeze(d));
}

/** Skipping is allowed. Three relics that all fight the build is a real hand. */
export function skipReward(data: GameData, state: RunState): RunActionResult {
  if (state.phase !== 'reward') return refuse('there is no reward to skip');
  const d = draft(state);
  d.rewardOffer = null;
  advance(data, d);
  return accept(freeze(d));
}

/** Moves to the next round, or ends the run if the last one is behind us. */
function advance(data: GameData, d: Draft): void {
  if (d.round >= data.run.rules.rounds) {
    d.phase = 'over';
    // Surviving the final round without beating it is not a victory, but it is
    // not a defeat either — lives held, boss standing. Scored as a defeat, and
    // the history says why.
    d.result = 'defeat';
    return;
  }
  d.round += 1;
  beginRound(data, d);
}

// ---------------------------------------------------------------------------
// Convenience for callers that hold both halves
// ---------------------------------------------------------------------------

/** Everything a UI needs to render the current board without re-deriving it. */
export function boardSummary(
  data: GameData,
  state: RunState,
): { deployments: Deployment[]; full: boolean; merges: ReturnType<typeof mergeOpportunities> } {
  return {
    deployments: toDeployments(state.board),
    full: isFull(state.board),
    merges: mergeOpportunities(data, state.board),
  };
}

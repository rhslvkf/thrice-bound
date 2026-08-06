/**
 * A scripted player.
 *
 * Plays a whole run without a human: shops, merges, fights, takes rewards. It
 * exists so run length and run difficulty can be *measured* rather than
 * guessed, and so a change to the shop curve or the encounter ladder shows up
 * as a number instead of as a feeling three playtests later.
 *
 * The policy is deliberately **competent, not optimal**. An optimal player
 * would report the shortest possible run and the highest possible win rate,
 * neither of which is what the game will actually be. The rules below are the
 * ones a person picks up in their second run: chase pairs, merge on sight,
 * take the relic that matches your board, do not reroll when broke.
 *
 * Every decision is a pure function of the run state, so a seed still
 * reproduces a whole playthrough end to end.
 */

import type { GameData, UnitDef } from '../data/schema';
import { runBattle } from '../core/battle/index';
import {
  battleSetupFor,
  buyUnit,
  chooseReward,
  firstFreeCell,
  isFull,
  mergeOpportunities,
  mergeUnits,
  priceOf,
  rerollCost,
  rerollShop,
  resolveBattle,
  sellUnit,
  startBattle,
  startRun,
  tagCounts,
  weightOf,
} from '../core/run/index';
import type { RunActionResult, RunState } from '../core/run/index';
import { RUN_POLICY } from './config';

/** Counts of decisions a human would have had to make. Feeds the pacing model. */
export interface RunActivity {
  readonly shopsVisited: number;
  readonly purchases: number;
  readonly rerolls: number;
  readonly sells: number;
  readonly merges: number;
  readonly rewardChoices: number;
  readonly battles: number;
  /** Total ticks simulated across every battle. Playback time at 1x. */
  readonly battleTicks: number;
}

export interface PlayedRun {
  readonly state: RunState;
  readonly activity: RunActivity;
}

interface Tally {
  shopsVisited: number;
  purchases: number;
  rerolls: number;
  sells: number;
  merges: number;
  rewardChoices: number;
  battles: number;
  battleTicks: number;
}

/** Rough power heuristic, matching the one the content tests use. */
function power(unit: UnitDef): number {
  return unit.stats.hp * unit.stats.atk * unit.stats.atkSpeed;
}

function take(result: RunActionResult, fallback: RunState): RunState {
  return result.ok ? result.state : fallback;
}

/** How many copies of each unit are on the board. */
function copies(state: RunState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of state.board) {
    counts.set(slot.unitId, (counts.get(slot.unitId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Scores a shop slot.
 *
 * The dominant term is merge progress: a third copy is worth far more than a
 * new body, because it is the only thing that produces a tier 2. That single
 * rule is most of what separates a player who wins round 7 from one who does
 * not, which is why the scripted player follows it before anything else.
 */
function scoreSlot(data: GameData, state: RunState, index: number): number {
  const slot = state.shop[index];
  if (slot?.unitId === undefined || slot.unitId === null) return -Infinity;

  const def = data.units.get(slot.unitId);
  if (def === undefined) return -Infinity;
  if (priceOf(data, slot.unitId) > state.gold) return -Infinity;

  const held = copies(state).get(slot.unitId) ?? 0;
  const counts = tagCounts(data, state.board);
  const tagFit = def.tags.reduce((best, tag) => Math.max(best, counts.get(tag) ?? 0), 0);

  let score = RUN_POLICY.tierScore * def.tier + tagFit * RUN_POLICY.tagFitScore;
  if (held >= 2) score += RUN_POLICY.completesMergeScore;
  else if (held === 1) score += RUN_POLICY.pairsUpScore;
  return score;
}

/** Cheapest board unit worth giving up to make room. Never a merge candidate. */
function sacrificeCell(data: GameData, state: RunState): { col: number; row: number } | null {
  const counts = copies(state);
  let worst: { cell: { col: number; row: number }; score: number } | null = null;

  for (const slot of state.board) {
    if ((counts.get(slot.unitId) ?? 0) > 1) continue; // part of a pair, keep it
    const def = data.units.get(slot.unitId);
    if (def === undefined) continue;
    const score = power(def);
    if (worst === null || score < worst.score) {
      worst = { cell: { col: slot.col, row: slot.row }, score };
    }
  }
  return worst?.cell ?? null;
}

/**
 * Picks a merge direction.
 *
 * Prefers the option that opens or deepens a tag the board is already running —
 * the merge *is* the synergy decision — and falls back to raw power when
 * neither option changes the tag picture.
 */
function chooseMergeOption(
  data: GameData,
  state: RunState,
  options: readonly UnitDef[],
): UnitDef | undefined {
  const counts = tagCounts(data, state.board);
  let best: { option: UnitDef; score: number } | undefined;

  for (const option of options) {
    const synergyGain = option.tags.reduce(
      (sum, tag) => sum + (counts.get(tag) ?? 0),
      0,
    );
    const score = synergyGain * RUN_POLICY.mergeSynergyWeight + power(option) / 1000;
    if (best === undefined || score > best.score) best = { option, score };
  }
  return best?.option;
}

/** Merges everything available, repeatedly — a merge can enable another. */
function mergeAll(data: GameData, state: RunState, tally: Tally): RunState {
  let current = state;
  for (let guard = 0; guard < RUN_POLICY.maxMergesPerRound; guard += 1) {
    const opportunity = mergeOpportunities(data, current.board)[0];
    if (opportunity === undefined) break;

    const chosen = chooseMergeOption(data, current, opportunity.options);
    if (chosen === undefined) break;

    const result = mergeUnits(data, current, opportunity.unitId, chosen.id);
    if (!result.ok) break;
    current = result.state;
    tally.merges += 1;
  }
  return current;
}

/**
 * Plays the shop for one round.
 *
 * Buys while something on the shelf is worth more than the gold it costs,
 * rerolls when the shelf is dead and the purse can afford to, and stops when
 * neither is true. Merging happens between purchases, because clearing three
 * cells into one is what makes room for the next buy.
 */
function playShop(data: GameData, state: RunState, tally: Tally): RunState {
  let current = state;
  tally.shopsVisited += 1;

  for (let step = 0; step < RUN_POLICY.maxShopActions; step += 1) {
    current = mergeAll(data, current, tally);

    const ranked = current.shop
      .map((_, index) => ({ index, score: scoreSlot(data, current, index) }))
      .filter((entry) => entry.score > -Infinity)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (best !== undefined) {
      if (isFull(current.board)) {
        // Only clear a cell for something that actually advances a merge;
        // trading a body for a body is churn.
        if (best.score < RUN_POLICY.completesMergeScore) break;
        const cell = sacrificeCell(data, current);
        if (cell === null) break;
        current = take(sellUnit(data, current, cell), current);
        tally.sells += 1;
      }
      if (firstFreeCell(current.board) === null) break;

      const bought = buyUnit(data, current, best.index);
      if (bought.ok) {
        current = bought.state;
        tally.purchases += 1;
        continue;
      }
    }

    // Nothing worth buying. Reroll only with gold to spare — going broke to
    // chase a shop is how a run ends on round 5.
    const cost = rerollCost(data, current);
    const affordable = current.gold - cost >= RUN_POLICY.goldReserve;
    if (current.rerolls >= RUN_POLICY.maxRerollsPerRound || !affordable) break;

    const rerolled = rerollShop(data, current);
    if (!rerolled.ok) break;
    current = rerolled.state;
    tally.rerolls += 1;
  }

  return mergeAll(data, current, tally);
}

/** Takes the offered relic that best fits the board — what a player would do. */
function takeReward(data: GameData, state: RunState, tally: Tally): RunState {
  const offer = state.rewardOffer ?? [];
  let best: { id: string; weight: number } | undefined;

  for (const id of offer) {
    const relic = data.relics.get(id);
    if (relic === undefined) continue;
    const weight = weightOf(data, relic, state.round, state.board);
    if (best === undefined || weight > best.weight) best = { id, weight };
  }
  if (best === undefined) return state;

  tally.rewardChoices += 1;
  return take(chooseReward(data, state, best.id), state);
}

/**
 * Plays one run to completion.
 *
 * Bounded by a step guard rather than trusting the state machine to terminate:
 * a policy bug that stalls in the shop would otherwise hang the simulator
 * rather than reporting a broken run.
 */
export function playRun(data: GameData, seed: number): PlayedRun {
  const tally: Tally = {
    shopsVisited: 0,
    purchases: 0,
    rerolls: 0,
    sells: 0,
    merges: 0,
    rewardChoices: 0,
    battles: 0,
    battleTicks: 0,
  };

  let state = startRun(data, seed);
  const maxSteps = data.run.rules.rounds * RUN_POLICY.maxStepsPerRound;

  for (let step = 0; step < maxSteps && state.phase !== 'over'; step += 1) {
    switch (state.phase) {
      case 'shop':
      case 'prep': {
        state = playShop(data, state, tally);
        const started = startBattle(state);
        if (!started.ok) {
          // No units and no way to get any — the run is stuck, not playing on.
          return { state: { ...state, phase: 'over', result: 'defeat' }, activity: tally };
        }
        state = started.state;
        break;
      }

      case 'battle': {
        const result = runBattle(data, battleSetupFor(data, state));
        tally.battles += 1;
        tally.battleTicks += result.ticks;
        state = resolveBattle(data, state, result);
        break;
      }

      case 'reward':
        state = takeReward(data, state, tally);
        break;
    }
  }

  return { state, activity: tally };
}

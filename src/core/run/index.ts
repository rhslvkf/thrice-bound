/**
 * Public entry point for the run loop.
 *
 * A run is twelve rounds of shop -> prep -> battle -> reward wrapped in a
 * health pool. Everything here is pure: states in, states out, randomness from
 * the seed, no clock and no storage.
 */

export {
  BOARD_CAPACITY,
  applyMerge,
  firstFreeCell,
  isFull,
  isPlayerCell,
  mergeOpportunities,
  place,
  playerCells,
  removeAt,
  swap,
  tagCounts,
  toDeployments,
  unitAt,
} from './board';
export type { Cell, MergeOpportunity } from './board';

export {
  battleSetupFor,
  boardSummary,
  buyUnit,
  chooseReward,
  encounterFor,
  enterPrep,
  incomeFor,
  isBossRound,
  isFinalRound,
  mergeUnits,
  moveUnit,
  rerollCost,
  rerollShop,
  resolveBattle,
  returnToShop,
  sellUnit,
  sellValue,
  skipReward,
  startBattle,
  startRun,
  toggleLock,
} from './run';

export { rollRewards, relicTagIndex, tagsOf, weightOf } from './rewards';
export { priceOf, rollShop, shopOddsFrom, tierWeightsFor } from './shop';
export { streamRng, streamSeed } from './streams';
export type { StreamLabel } from './streams';
export { activeShopOddsRelics, fireRunHooks } from './relics';
export type { RunHookContext, RunHookOutcome } from './relics';
export { deserializeRun, serializeRun } from './serialize';
export type { LoadFailure, LoadResult, LoadSuccess } from './serialize';

export { RUN_PHASES, RUN_SAVE_VERSION, accept, refuse } from './types';
export type {
  BoardSlot,
  RoundRecord,
  RunActionResult,
  RunPhase,
  RunRefusal,
  RunResult,
  RunState,
  RunSuccess,
  ShopSlot,
} from './types';

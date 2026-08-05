/**
 * Public entry point for the battle engine.
 *
 * Two ways in:
 *
 * - `runBattle` — simulate to completion and hand back the outcome plus the
 *   full event log. This is what the balance simulator uses.
 * - `createBattle` + `stepBattle` — drive it a tick at a time, for a renderer
 *   that wants to interleave playback with simulation, or for tests that need
 *   to inspect an intermediate state.
 */

import type { GameData } from '../../data/schema';
import { MAX_TICKS } from '../config';
import type { BattleEvent } from './events';
import { createBattle } from './setup';
import type { BattleSetup } from './setup';
import { stepBattle } from './tick';
import type { BattleOutcome, BattleState, EndReason } from './types';

export interface BattleResult {
  readonly outcome: BattleOutcome;
  readonly reason: EndReason;
  /** Ticks simulated. Multiply by `BATTLE.tickMs` for the battle's duration. */
  readonly ticks: number;
  /**
   * Everything that happened, in order. The renderer replays this rather than
   * reading state — see `events.ts`.
   */
  readonly events: readonly BattleEvent[];
  readonly finalState: BattleState;
}

/**
 * Simulates a battle to completion.
 *
 * Termination is guaranteed: every step advances the tick by one, and
 * `resolveEnd` forces an outcome once `MAX_TICKS` is reached. The extra bound
 * on the loop is belt-and-braces against a future change breaking that.
 */
export function runBattle(data: GameData, setup: BattleSetup): BattleResult {
  const start = createBattle(data, setup);
  let state = start.state;
  const events: BattleEvent[] = [...start.events];

  while (state.outcome === null && state.tick <= MAX_TICKS) {
    const result = stepBattle(data, state);
    state = result.state;
    for (const event of result.events) events.push(event);
  }

  return {
    // A battle that somehow left the loop undecided is scored a draw rather
    // than reported as a broken result.
    outcome: state.outcome ?? 'draw',
    reason: state.endReason ?? 'timeout',
    ticks: state.tick,
    events,
    finalState: state,
  };
}

export { createBattle } from './setup';
export type { BattleSetup, BattleStart, Deployment } from './setup';
export { resolveEnd, stepBattle } from './tick';
export type { TickResult } from './tick';
export type {
  AbilityEvent,
  AttackEvent,
  BattleEndEvent,
  BattleEvent,
  BattleEventKind,
  BattleStartEvent,
  DamageEvent,
  DeathEvent,
  HealEvent,
  MoveEvent,
  ShieldEvent,
  SpawnEvent,
  StatModEvent,
  StatusEvent,
  SynergyAppliedEvent,
} from './events';
export type {
  ActiveMod,
  ActivePeriodic,
  ActiveStatus,
  BattleOutcome,
  BattleState,
  BattleUnit,
  Cell,
  ShieldEntry,
  EndReason,
  Team,
} from './types';
export { opposing, TEAMS } from './types';
export { attackRange, effectiveStat, isStunned, totalShield } from './stats';
export { distance } from './grid';
export { satisfiedThreshold, tagCount } from './synergy';

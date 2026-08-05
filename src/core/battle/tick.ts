/**
 * The simulation step.
 *
 * `stepBattle` takes a state and returns the next one. It is pure: the input
 * is never mutated, no clock is read, and the only randomness comes from the
 * seeded RNG carried inside the state. The same state stepped twice produces
 * two identical results.
 *
 * Order within a tick is fixed, and changing it changes every battle:
 *
 *   1. age modifiers, statuses and cooldowns
 *   2. apply damage-over-time
 *   3. fire periodic effects that came due
 *   4. fire `interval` abilities that came due
 *   5. each living unit, in instance-id order, acts once
 *   6. drain queued reaction triggers
 *   7. test the end conditions
 */

import type { GameData } from '../../data/schema';
import { BATTLE, MAX_TICKS } from '../config';
import {
  drainTriggers,
  tickAbilityCooldowns,
  tickIntervalAbilities,
  tryTrigger,
} from './abilities';
import type { BattleContext } from './context';
import { createContext, emit, livingOf, toState } from './context';
import { applyDamageOverTime, performAttack } from './damage';
import { tickPeriodics } from './effects';
import type { BattleEvent } from './events';
import { distance } from './grid';
import { stepToward } from './movement';
import {
  attackIntervalMs,
  attackRange,
  expireTimedEffects,
  isStunned,
  totalShield,
} from './stats';
import { acquireTarget, turnOrder } from './targeting';
import type { BattleOutcome, BattleState, EndReason, Team } from './types';
import { TEAMS } from './types';

/** The product of one tick: the next state, and what happened getting there. */
export interface TickResult {
  readonly state: BattleState;
  /**
   * Events produced by this tick alone. They are not accumulated inside the
   * state, which keeps stepping O(units) rather than O(units x ticks); callers
   * that want a full log concatenate as they go.
   */
  readonly events: readonly BattleEvent[];
}

/** One unit's turn: attack if the target is in reach, otherwise close in. */
function takeTurn(ctx: BattleContext, unitId: number): void {
  const unit = ctx.units.find((candidate) => candidate.instanceId === unitId);
  if (unit === undefined || !unit.alive) return;
  if (isStunned(unit)) return;

  const target = acquireTarget(ctx, unit);
  if (target === null) return;

  if (distance(unit, target) <= attackRange(unit)) {
    if (unit.attackCooldownMs <= 0) {
      performAttack(ctx, unit, target);
      unit.attackCooldownMs = attackIntervalMs(unit);
      tryTrigger(ctx, unit, 'onAttack', {
        sourceId: unit.instanceId,
        eventSourceId: null,
        attackTargetId: target.instanceId,
      });
    }
    return;
  }

  stepToward(ctx, unit, target);
}

/** Ages every per-unit timer by one tick. */
function ageTimers(ctx: BattleContext, elapsedMs: number): void {
  for (const unit of ctx.units) {
    if (!unit.alive) continue;
    unit.attackCooldownMs = Math.max(0, unit.attackCooldownMs - elapsedMs);
    unit.moveCooldownMs = Math.max(0, unit.moveCooldownMs - elapsedMs);
    expireTimedEffects(unit, elapsedMs);
  }
  tickAbilityCooldowns(ctx, elapsedMs);
}

/** Remaining HP plus shield, as a fraction of what the team started with. */
function survivingFraction(ctx: BattleContext, team: Team): number {
  const starting = ctx.startingHp[team];
  if (starting <= 0) return 0;
  const remaining = livingOf(ctx, team).reduce(
    (sum, unit) => sum + unit.hp + totalShield(unit),
    0,
  );
  return remaining / starting;
}

/**
 * Decides whether the battle is over, and how.
 *
 * Three outcomes are possible:
 *
 * - **wipe** — one team has no living units; the other wins.
 * - **mutualWipe** — both teams emptied on the same tick (a death ability
 *   taking the last enemy with it). Neither side won: it is a draw.
 * - **timeout** — `MAX_TICKS` elapsed. The side holding the larger fraction of
 *   its starting HP wins; an exact tie is a draw. Comparing fractions rather
 *   than raw HP keeps the rule fair between a five-unit board and a two-unit
 *   one.
 */
export function resolveEnd(
  ctx: BattleContext,
): { outcome: BattleOutcome; reason: EndReason } | null {
  const playerAlive = livingOf(ctx, 'player').length;
  const enemyAlive = livingOf(ctx, 'enemy').length;

  if (playerAlive === 0 && enemyAlive === 0) {
    return { outcome: 'draw', reason: 'mutualWipe' };
  }
  if (enemyAlive === 0) return { outcome: 'player', reason: 'wipe' };
  if (playerAlive === 0) return { outcome: 'enemy', reason: 'wipe' };

  if (ctx.tick >= MAX_TICKS) {
    const player = survivingFraction(ctx, 'player');
    const enemy = survivingFraction(ctx, 'enemy');
    if (player > enemy) return { outcome: 'player', reason: 'timeout' };
    if (enemy > player) return { outcome: 'enemy', reason: 'timeout' };
    return { outcome: 'draw', reason: 'timeout' };
  }

  return null;
}

/**
 * Advances the battle by one tick.
 *
 * Calling this on an already-finished state is a no-op that returns the state
 * unchanged, so a caller cannot accidentally simulate past the end.
 */
export function stepBattle(data: GameData, state: BattleState): TickResult {
  if (state.outcome !== null) return { state, events: [] };

  const ctx = createContext(data, state);
  const elapsedMs = BATTLE.tickMs;

  ageTimers(ctx, elapsedMs);
  for (const unit of turnOrder(ctx)) applyDamageOverTime(ctx, unit, elapsedMs);
  drainTriggers(ctx);

  tickPeriodics(ctx, elapsedMs);
  tickIntervalAbilities(ctx, elapsedMs);
  drainTriggers(ctx);

  // Ids are captured up front so a unit summoned mid-tick waits for the next
  // one, and so a unit that dies mid-tick is simply skipped.
  for (const unit of turnOrder(ctx)) takeTurn(ctx, unit.instanceId);
  drainTriggers(ctx);

  const ending = resolveEnd(ctx);
  if (ending !== null) {
    emit(ctx, {
      kind: 'battleEnd',
      outcome: ending.outcome,
      reason: ending.reason,
      playerAlive: livingOf(ctx, 'player').length,
      enemyAlive: livingOf(ctx, 'enemy').length,
    });
  }

  return {
    state: toState(ctx, ending?.outcome ?? null, ending?.reason ?? null),
    events: ctx.events,
  };
}

/** Total starting HP per team, for the timeout rule. */
export function totalHpByTeam(
  units: readonly { team: Team; maxHp: number }[],
): Record<Team, number> {
  const totals: Record<Team, number> = { player: 0, enemy: 0 };
  for (const team of TEAMS) {
    totals[team] = units
      .filter((unit) => unit.team === team)
      .reduce((sum, unit) => sum + unit.maxHp, 0);
  }
  return totals;
}

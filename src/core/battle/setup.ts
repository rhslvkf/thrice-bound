/**
 * Battle bootstrap.
 *
 * Turns a board layout into tick 0: units placed, synergies counted and
 * applied, `onSpawn` abilities fired. Everything after this is `stepBattle`.
 */

import { BOARD, type GameData } from '../../data/schema';
import { drainTriggers } from './abilities';
import type { BattleContext } from './context';
import { createContext, emit, toState } from './context';
import type { BattleEvent } from './events';
import { isOnBoard, occupantAt } from './grid';
import { applyBattleStartRelics } from './relics';
import { spawnUnit } from './spawn';
import { applySynergies } from './synergy';
import { totalHpByTeam } from './tick';
import type { BattleState, Team } from './types';
import { TEAMS } from './types';

/** One unit placed on the board before the battle starts. */
export interface Deployment {
  /** A unit id from `units.json`. */
  readonly unitId: string;
  readonly col: number;
  readonly row: number;
}

export interface BattleSetup {
  /** Seeds the battle's RNG. The same seed and layout always replay alike. */
  readonly seed: number;
  readonly player: readonly Deployment[];
  readonly enemy: readonly Deployment[];
  /**
   * The player's relics, in collection order. Omitted means none, which is how
   * the balance simulator runs — a matchup with no relics must produce exactly
   * the numbers it produced before relics existed.
   */
  readonly relicIds?: readonly string[];
}

/** Tick 0: the state the battle begins from, and the events that set it up. */
export interface BattleStart {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
}

/** Rows a team is allowed to deploy on. */
function homeRows(team: Team): readonly number[] {
  return team === 'player' ? BOARD.playerRows : BOARD.enemyRows;
}

function validate(ctx: BattleContext, team: Team, deployment: Deployment): void {
  const where = `${team} deployment of ${JSON.stringify(deployment.unitId)}`;
  if (!isOnBoard(deployment)) {
    throw new Error(
      `${where}: cell (${deployment.col}, ${deployment.row}) is off a ${BOARD.cols}x${BOARD.rows} board`,
    );
  }
  if (!homeRows(team).includes(deployment.row)) {
    throw new Error(
      `${where}: the ${team} team deploys on rows ${homeRows(team).join(' and ')}, not ${deployment.row}`,
    );
  }
  if (occupantAt(ctx.units, deployment) !== null) {
    throw new Error(
      `${where}: cell (${deployment.col}, ${deployment.row}) is already occupied`,
    );
  }
  if (!ctx.data.units.has(deployment.unitId)) {
    throw new Error(`${where}: no such unit`);
  }
}

/**
 * Builds the tick-0 state.
 *
 * Order matters and is fixed: units spawn, then synergies apply, then
 * `onSpawn` abilities fire. Board-level bonuses land before unit-level ones,
 * so an ability that reads a stat sees the synergy already folded in.
 *
 * @throws {Error} if a deployment is off-board, on the wrong side, stacked on
 *   another unit, or names a unit that does not exist.
 */
export function createBattle(data: GameData, setup: BattleSetup): BattleStart {
  const seedState: BattleState = {
    // -1 so the context's first tick is 0: battle start is tick 0, and the
    // first simulated tick is 1.
    tick: -1,
    rngState: setup.seed >>> 0,
    units: [],
    periodics: [],
    nextInstanceId: 0,
    relicIds: setup.relicIds ?? [],
    startingHp: { player: 0, enemy: 0 },
    outcome: null,
    endReason: null,
  };

  const ctx = createContext(data, seedState);
  emit(ctx, { kind: 'battleStart', seed: seedState.rngState });

  const deployments: Record<Team, readonly Deployment[]> = {
    player: setup.player,
    enemy: setup.enemy,
  };
  for (const team of TEAMS) {
    for (const deployment of deployments[team]) {
      validate(ctx, team, deployment);
      spawnUnit(ctx, deployment.unitId, team, deployment.col, deployment.row, false);
    }
  }

  applySynergies(ctx);
  // After synergies, so a relic gated on a tag count reads the same board the
  // synergy did, and before `startingHp` is measured below, so a relic that
  // adds max HP counts toward the timeout rule.
  applyBattleStartRelics(ctx);
  drainTriggers(ctx);

  // Measured after battle-start effects, so a Steel board's +10% max HP counts
  // toward the timeout rule rather than showing up as instant damage.
  const totals = totalHpByTeam(ctx.units);
  ctx.startingHp.player = totals.player;
  ctx.startingHp.enemy = totals.enemy;

  return { state: toState(ctx, null, null), events: ctx.events };
}

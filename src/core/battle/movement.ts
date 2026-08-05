/**
 * Movement.
 *
 * Units occupy whole cells and step to an adjacent one when their move
 * cooldown comes up. There is no sub-cell position and no interpolation state:
 * a unit is either on the cell it left or the cell it arrived at. The `move`
 * event carries both endpoints and the step duration so the renderer can tween
 * between them at whatever frame rate it is running.
 */

import type { BattleContext } from './context';
import { emit } from './context';
import { distance, neighboursOf, occupantAt } from './grid';
import { stepIntervalMs } from './stats';
import type { BattleUnit, Cell } from './types';

/**
 * Picks the step that gets closest to `goal`.
 *
 * Candidates are considered in the fixed {@link NEIGHBOUR_OFFSETS} order and
 * the first strict improvement wins, so ties resolve identically on every run.
 * Occupied cells are skipped — one unit per cell, and units do not push past
 * each other.
 */
export function bestStepToward(
  ctx: BattleContext,
  unit: BattleUnit,
  goal: Cell,
): Cell | null {
  const current = distance(unit, goal);
  let best: Cell | null = null;
  let bestDistance = current;

  for (const candidate of neighboursOf(unit)) {
    if (occupantAt(ctx.units, candidate) !== null) continue;
    const candidateDistance = distance(candidate, goal);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Moves a unit one cell toward its goal if its move cooldown has elapsed.
 *
 * Returns `true` if it stepped. A unit that is boxed in, or whose move speed
 * has been slowed to nothing, simply stands still — its cooldown stays at zero
 * so it steps the instant a path opens.
 */
export function stepToward(
  ctx: BattleContext,
  unit: BattleUnit,
  goal: Cell,
): boolean {
  if (unit.moveCooldownMs > 0) return false;

  const interval = stepIntervalMs(unit);
  if (interval === null) return false;

  const destination = bestStepToward(ctx, unit, goal);
  if (destination === null) return false;

  const fromCol = unit.col;
  const fromRow = unit.row;
  unit.col = destination.col;
  unit.row = destination.row;
  unit.moveCooldownMs = interval;

  emit(ctx, {
    kind: 'move',
    instanceId: unit.instanceId,
    fromCol,
    fromRow,
    toCol: destination.col,
    toRow: destination.row,
    durationMs: interval,
  });
  return true;
}

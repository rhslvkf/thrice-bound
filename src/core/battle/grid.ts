/**
 * Board geometry.
 *
 * Distance is Chebyshev — diagonals cost the same as orthogonals — so a
 * `range` of 1 means "any of the eight surrounding cells" and units move in
 * eight directions. Every helper here is deterministic and order-stable;
 * nothing about the board consults the RNG.
 */

import { BOARD } from '../../data/schema';
import type { BattleUnit, Cell } from './types';

/**
 * Neighbour offsets in a fixed order.
 *
 * The order is the tie-breaker when several steps are equally good, so it must
 * never be sorted, shuffled or derived at runtime — changing it changes battle
 * outcomes.
 */
export const NEIGHBOUR_OFFSETS: readonly Cell[] = [
  { col: 0, row: -1 },
  { col: 1, row: -1 },
  { col: 1, row: 0 },
  { col: 1, row: 1 },
  { col: 0, row: 1 },
  { col: -1, row: 1 },
  { col: -1, row: 0 },
  { col: -1, row: -1 },
];

/** Chebyshev distance in cells. */
export function distance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

export function isOnBoard(cell: Cell): boolean {
  return (
    cell.col >= 0 && cell.col < BOARD.cols && cell.row >= 0 && cell.row < BOARD.rows
  );
}

/** On-board neighbours of a cell, in {@link NEIGHBOUR_OFFSETS} order. */
export function neighboursOf(cell: Cell): Cell[] {
  const result: Cell[] = [];
  for (const offset of NEIGHBOUR_OFFSETS) {
    const candidate = { col: cell.col + offset.col, row: cell.row + offset.row };
    if (isOnBoard(candidate)) result.push(candidate);
  }
  return result;
}

/** The living unit standing on a cell, if any. One unit per cell. */
export function occupantAt(
  units: readonly BattleUnit[],
  cell: Cell,
): BattleUnit | null {
  return (
    units.find(
      (unit) => unit.alive && unit.col === cell.col && unit.row === cell.row,
    ) ?? null
  );
}

export function isFree(units: readonly BattleUnit[], cell: Cell): boolean {
  return occupantAt(units, cell) === null;
}

/**
 * Free cells ordered by distance from an origin, then by column, then row.
 *
 * Used to place summons. The ordering is total and content-independent, so a
 * summon lands in the same cell on every replay.
 */
export function freeCellsNear(units: readonly BattleUnit[], origin: Cell): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < BOARD.rows; row += 1) {
    for (let col = 0; col < BOARD.cols; col += 1) {
      const cell = { col, row };
      if (isFree(units, cell)) cells.push(cell);
    }
  }
  return cells.sort((a, b) => {
    const byDistance = distance(origin, a) - distance(origin, b);
    if (byDistance !== 0) return byDistance;
    if (a.col !== b.col) return a.col - b.col;
    return a.row - b.row;
  });
}

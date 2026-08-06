/**
 * The player's half of the board, between fights.
 *
 * Board composition decides the battle, so it is game state rather than
 * presentation — this used to live in `src/render/prep` with a note saying so,
 * and moved here once run state existed to hold it.
 *
 * Functions over a plain `BoardSlot[]`, not a class: the board is part of
 * {@link RunState}, and run state has to survive a JSON round-trip.
 *
 * The merge *rules* come from `src/data` — which units combine and what they
 * may become — so nothing about the merge tree is duplicated here.
 */

import { BOARD, MERGE_COST_IN_COPIES } from '../../data/schema';
import type { GameData, UnitDef } from '../../data/schema';
import type { Deployment } from '../battle/index';
import type { BoardSlot } from './types';

export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** A merge the player could perform right now. */
export interface MergeOpportunity {
  readonly unitId: string;
  readonly name: string;
  /** The cells holding the copies, in board order. */
  readonly cells: readonly Cell[];
  /** Upgrade candidates. The choice this game is built around. */
  readonly options: readonly UnitDef[];
}

export const BOARD_CAPACITY = BOARD.cols * BOARD.playerRows.length;

export function isPlayerCell(col: number, row: number): boolean {
  return (
    Number.isInteger(col) &&
    col >= 0 &&
    col < BOARD.cols &&
    (BOARD.playerRows as readonly number[]).includes(row)
  );
}

/** Every cell the player may use, in a fixed order. */
export function playerCells(): Cell[] {
  const cells: Cell[] = [];
  for (const row of BOARD.playerRows) {
    for (let col = 0; col < BOARD.cols; col += 1) cells.push({ col, row });
  }
  return cells;
}

export function unitAt(board: readonly BoardSlot[], col: number, row: number): string | null {
  return board.find((slot) => slot.col === col && slot.row === row)?.unitId ?? null;
}

/** Board order, so two equal boards always serialize identically. */
function sortBoard(board: readonly BoardSlot[]): BoardSlot[] {
  return [...board].sort((a, b) => (a.row - b.row) || (a.col - b.col));
}

export function firstFreeCell(board: readonly BoardSlot[]): Cell | null {
  for (const cell of playerCells()) {
    if (unitAt(board, cell.col, cell.row) === null) return cell;
  }
  return null;
}

export function isFull(board: readonly BoardSlot[]): boolean {
  return board.length >= BOARD_CAPACITY;
}

/** Places a unit, replacing whatever was there. Returns a new board. */
export function place(
  board: readonly BoardSlot[],
  col: number,
  row: number,
  unitId: string,
): BoardSlot[] {
  if (!isPlayerCell(col, row)) {
    throw new Error(`cell (${col}, ${row}) is not on the player's half`);
  }
  const rest = board.filter((slot) => !(slot.col === col && slot.row === row));
  return sortBoard([...rest, { col, row, unitId }]);
}

export function removeAt(board: readonly BoardSlot[], col: number, row: number): BoardSlot[] {
  return board.filter((slot) => !(slot.col === col && slot.row === row));
}

/** Exchanges two cells. Either may be empty, which makes this a move. */
export function swap(board: readonly BoardSlot[], a: Cell, b: Cell): BoardSlot[] {
  const first = unitAt(board, a.col, a.row);
  const second = unitAt(board, b.col, b.row);
  let next = removeAt(removeAt(board, a.col, a.row), b.col, b.row);
  if (second !== null) next = place(next, a.col, a.row, second);
  if (first !== null) next = place(next, b.col, b.row, first);
  return sortBoard(next);
}

/**
 * Merges available right now.
 *
 * A merge needs `MERGE_COST_IN_COPIES` of the same unit on the board, and that
 * unit must have somewhere to go — tier 3 is terminal, so three of those are
 * just three of those.
 */
export function mergeOpportunities(
  data: GameData,
  board: readonly BoardSlot[],
): MergeOpportunity[] {
  const byUnit = new Map<string, Cell[]>();
  for (const cell of playerCells()) {
    const unitId = unitAt(board, cell.col, cell.row);
    if (unitId === null) continue;
    const cells = byUnit.get(unitId) ?? [];
    cells.push(cell);
    byUnit.set(unitId, cells);
  }

  const opportunities: MergeOpportunity[] = [];
  for (const [unitId, cells] of byUnit) {
    if (cells.length < MERGE_COST_IN_COPIES) continue;
    const def = data.units.get(unitId);
    if (def === undefined || def.mergesInto.length === 0) continue;

    const options = def.mergesInto
      .map((id) => data.units.get(id))
      .filter((option): option is UnitDef => option !== undefined);
    if (options.length === 0) continue;

    opportunities.push({
      unitId,
      name: def.name,
      cells: cells.slice(0, MERGE_COST_IN_COPIES),
      options,
    });
  }
  // Stable order, so the merge button does not jump between identical boards.
  return opportunities.sort((a, b) => a.unitId.localeCompare(b.unitId));
}

/**
 * Consumes the copies and puts the chosen upgrade down.
 *
 * The upgrade lands on the first of the consumed cells, which is where the
 * renderer's convergence animation ends.
 */
export function applyMerge(
  board: readonly BoardSlot[],
  opportunity: MergeOpportunity,
  chosenId: string,
): { board: BoardSlot[]; cell: Cell } {
  const destination = opportunity.cells[0];
  if (destination === undefined) throw new Error('merge has no cells to consume');

  let next: BoardSlot[] = [...board];
  for (const cell of opportunity.cells) next = removeAt(next, cell.col, cell.row);
  next = place(next, destination.col, destination.row, chosenId);
  return { board: next, cell: destination };
}

/** The board as the battle engine wants it. */
export function toDeployments(board: readonly BoardSlot[]): Deployment[] {
  return sortBoard(board).map((slot) => ({
    unitId: slot.unitId,
    col: slot.col,
    row: slot.row,
  }));
}

/**
 * How many *distinct* units on the board carry a tag.
 *
 * Distinct definitions, not bodies, matching the synergy counting rule — the
 * reward weighting has to agree with what the board actually does in a fight,
 * or it would push the player toward a synergy they are not really building.
 */
export function tagCounts(
  data: GameData,
  board: readonly BoardSlot[],
): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const slot of board) {
    const def = data.units.get(slot.unitId);
    if (def === undefined) continue;
    for (const tag of def.tags) {
      const ids = seen.get(tag) ?? new Set<string>();
      ids.add(def.id);
      seen.set(tag, ids);
    }
  }
  return new Map([...seen].map(([tag, ids]) => [tag, ids.size]));
}

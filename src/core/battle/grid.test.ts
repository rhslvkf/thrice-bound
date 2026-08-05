import { describe, expect, it } from 'vitest';
import { BOARD } from '../../data/schema';
import {
  distance,
  freeCellsNear,
  isFree,
  isOnBoard,
  NEIGHBOUR_OFFSETS,
  neighboursOf,
  occupantAt,
} from './grid';
import { createUnit } from './spawn';
import type { BattleUnit, Cell } from './types';

const stub = (instanceId: number, col: number, row: number, alive = true): BattleUnit => {
  const unit = createUnit(
    {
      id: `unit.stub${instanceId}`,
      name: 'Stub',
      tier: 1,
      tags: ['Beast'],
      cost: 1,
      stats: { hp: 10, atk: 1, atkSpeed: 1, range: 1, moveSpeed: 1 },
      abilityId: null,
      mergesInto: [],
      artKey: 'unit/stub',
    },
    instanceId,
    'player',
    col,
    row,
    false,
  );
  unit.alive = alive;
  return unit;
};

describe('distance', () => {
  it('is Chebyshev, so a diagonal costs the same as a straight step', () => {
    expect(distance({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(1);
    expect(distance({ col: 0, row: 0 }, { col: 1, row: 0 })).toBe(1);
    expect(distance({ col: 0, row: 0 }, { col: 3, row: 2 })).toBe(3);
  });

  it('is zero to itself and symmetric', () => {
    const a = { col: 2, row: 1 };
    const b = { col: 4, row: 3 };
    expect(distance(a, a)).toBe(0);
    expect(distance(a, b)).toBe(distance(b, a));
  });

  it('never exceeds the longest side of the board', () => {
    const corner = { col: 0, row: 0 };
    const opposite = { col: BOARD.cols - 1, row: BOARD.rows - 1 };
    expect(distance(corner, opposite)).toBe(Math.max(BOARD.cols, BOARD.rows) - 1);
  });
});

describe('isOnBoard', () => {
  it('accepts every cell of the board and nothing else', () => {
    for (let row = 0; row < BOARD.rows; row += 1) {
      for (let col = 0; col < BOARD.cols; col += 1) {
        expect(isOnBoard({ col, row })).toBe(true);
      }
    }
    expect(isOnBoard({ col: -1, row: 0 })).toBe(false);
    expect(isOnBoard({ col: 0, row: -1 })).toBe(false);
    expect(isOnBoard({ col: BOARD.cols, row: 0 })).toBe(false);
    expect(isOnBoard({ col: 0, row: BOARD.rows })).toBe(false);
  });
});

describe('neighboursOf', () => {
  it('offers eight directions in the middle of the board', () => {
    expect(neighboursOf({ col: 2, row: 1 })).toHaveLength(8);
  });

  it('clips at the edges', () => {
    expect(neighboursOf({ col: 0, row: 0 })).toHaveLength(3);
    expect(neighboursOf({ col: BOARD.cols - 1, row: 0 })).toHaveLength(3);
  });

  it('returns cells in the fixed offset order', () => {
    // The order is the movement tie-breaker, so it must be stable.
    const centre: Cell = { col: 2, row: 1 };
    expect(neighboursOf(centre)).toEqual(
      NEIGHBOUR_OFFSETS.map((offset) => ({
        col: centre.col + offset.col,
        row: centre.row + offset.row,
      })),
    );
  });

  it('never includes the cell itself', () => {
    const centre = { col: 2, row: 1 };
    expect(neighboursOf(centre)).not.toContainEqual(centre);
  });
});

describe('occupancy', () => {
  it('finds the unit standing on a cell', () => {
    const units = [stub(0, 1, 1), stub(1, 3, 2)];
    expect(occupantAt(units, { col: 1, row: 1 })?.instanceId).toBe(0);
    expect(occupantAt(units, { col: 2, row: 1 })).toBeNull();
  });

  it('treats a corpse as an empty cell', () => {
    const units = [stub(0, 1, 1, false)];
    expect(occupantAt(units, { col: 1, row: 1 })).toBeNull();
    expect(isFree(units, { col: 1, row: 1 })).toBe(true);
  });
});

describe('freeCellsNear', () => {
  it('orders by distance from the origin', () => {
    const cells = freeCellsNear([], { col: 0, row: 0 });
    expect(cells).toHaveLength(BOARD.cols * BOARD.rows);
    expect(cells[0]).toEqual({ col: 0, row: 0 });
    for (let i = 1; i < cells.length; i += 1) {
      const previous = distance({ col: 0, row: 0 }, cells[i - 1] as Cell);
      const current = distance({ col: 0, row: 0 }, cells[i] as Cell);
      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  it('skips occupied cells', () => {
    const units = [stub(0, 0, 0), stub(1, 1, 0)];
    const cells = freeCellsNear(units, { col: 0, row: 0 });
    expect(cells).not.toContainEqual({ col: 0, row: 0 });
    expect(cells).not.toContainEqual({ col: 1, row: 0 });
    expect(cells).toHaveLength(BOARD.cols * BOARD.rows - 2);
  });

  it('is deterministic, so a summon lands in the same place every replay', () => {
    const units = [stub(0, 2, 1)];
    expect(freeCellsNear(units, { col: 2, row: 2 })).toEqual(
      freeCellsNear(units, { col: 2, row: 2 }),
    );
  });

  it('returns nothing when the board is full', () => {
    const units: BattleUnit[] = [];
    let id = 0;
    for (let row = 0; row < BOARD.rows; row += 1) {
      for (let col = 0; col < BOARD.cols; col += 1) {
        units.push(stub(id, col, row));
        id += 1;
      }
    }
    expect(freeCellsNear(units, { col: 0, row: 0 })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { BOARD } from '../data/schema';
import { BOARD_VIEW, LAYOUT } from './config';
import {
  cellFaceSize,
  computeLayout,
  depthOffset,
  depthScale,
  placeCell,
  rowDepth,
} from './layout';

/**
 * `src/render` is not normally a unit-test target — you verify a renderer by
 * looking at it. This file is the exception: layout is pure arithmetic with no
 * PixiJS in it, and getting it wrong puts things off-screen in a way that is
 * far quicker to catch here than by squinting at a canvas on four viewports.
 */

const VIEWPORTS = [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'phone landscape', width: 844, height: 390 },
  { name: 'tablet portrait', width: 820, height: 1180 },
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'ultrawide', width: 2560, height: 720 },
  { name: 'tiny', width: 240, height: 320 },
  { name: 'square', width: 800, height: 800 },
];

describe('computeLayout', () => {
  it('classifies orientation by aspect', () => {
    expect(computeLayout(390, 844).orientation).toBe('portrait');
    expect(computeLayout(844, 390).orientation).toBe('landscape');
    expect(computeLayout(800, 800).orientation).toBe('landscape');
  });

  it('keeps the board inside the safe area on every viewport', () => {
    for (const viewport of VIEWPORTS) {
      const layout = computeLayout(viewport.width, viewport.height);
      const { board, safe } = layout;
      expect(board.x, viewport.name).toBeGreaterThanOrEqual(safe.x - 0.01);
      expect(board.y, viewport.name).toBeGreaterThanOrEqual(safe.y - 0.01);
      expect(board.x + board.width, viewport.name).toBeLessThanOrEqual(
        safe.x + safe.width + 0.01,
      );
      expect(board.y + board.height, viewport.name).toBeLessThanOrEqual(
        safe.y + safe.height + 0.01,
      );
    }
  });

  it('never letterboxes — the safe area always fills the viewport minus margin', () => {
    for (const viewport of VIEWPORTS) {
      const layout = computeLayout(viewport.width, viewport.height);
      const margin = Math.min(viewport.width, viewport.height) * LAYOUT.safeMarginRatio;
      expect(layout.safe.width, viewport.name).toBeCloseTo(viewport.width - margin * 2, 5);
      expect(layout.safe.height, viewport.name).toBeCloseTo(viewport.height - margin * 2, 5);
    }
  });

  it('scales the board with the viewport rather than fixing a resolution', () => {
    const small = computeLayout(390, 844);
    const large = computeLayout(1920, 1080);
    expect(large.cellSize).toBeGreaterThan(small.cellSize);
  });

  it('clamps cell size so the board is neither unreadable nor absurd', () => {
    expect(computeLayout(120, 160).cellSize).toBeGreaterThanOrEqual(LAYOUT.minCellSize);
    expect(computeLayout(8000, 6000).cellSize).toBeLessThanOrEqual(LAYOUT.maxCellSize);
  });

  it('keeps the ui scale inside its band', () => {
    for (const viewport of [...VIEWPORTS, { name: 'huge', width: 6000, height: 4000 }]) {
      const { uiScale } = computeLayout(viewport.width, viewport.height);
      expect(uiScale, viewport.name).toBeGreaterThanOrEqual(LAYOUT.minUiScale);
      expect(uiScale, viewport.name).toBeLessThanOrEqual(LAYOUT.maxUiScale);
    }
  });

  it('centres the board horizontally', () => {
    for (const viewport of VIEWPORTS) {
      const layout = computeLayout(viewport.width, viewport.height);
      const boardCentre = layout.board.x + layout.board.width / 2;
      expect(boardCentre, viewport.name).toBeCloseTo(viewport.width / 2, 5);
    }
  });

  it('survives a degenerate viewport without producing NaN', () => {
    const layout = computeLayout(0, 0);
    expect(Number.isFinite(layout.cellSize)).toBe(true);
    expect(Number.isFinite(layout.board.x)).toBe(true);
    expect(Number.isFinite(layout.uiScale)).toBe(true);
  });
});

describe('perspective', () => {
  it('runs depth from 0 at the far row to 1 at the near row', () => {
    expect(rowDepth(0)).toBe(0);
    expect(rowDepth(BOARD.rows - 1)).toBe(1);
  });

  it('narrows the far row and leaves the near row unscaled', () => {
    expect(depthScale(0)).toBeCloseTo(BOARD_VIEW.farScale, 6);
    expect(depthScale(1)).toBeCloseTo(1, 6);
  });

  it('increases scale monotonically toward the viewer', () => {
    let previous = -1;
    for (let row = 0; row < BOARD.rows; row += 1) {
      const scale = depthScale(rowDepth(row));
      expect(scale).toBeGreaterThan(previous);
      previous = scale;
    }
  });

  it('bunches far rows closer together than near ones', () => {
    const gaps: number[] = [];
    for (let row = 1; row < BOARD.rows; row += 1) {
      gaps.push(depthOffset(rowDepth(row)) - depthOffset(rowDepth(row - 1)));
    }
    for (let i = 1; i < gaps.length; i += 1) {
      // Each step toward the viewer covers more ground than the last.
      expect(gaps[i] as number).toBeGreaterThan(gaps[i - 1] as number);
    }
  });

  it('spans the full board height from the first row to the last', () => {
    expect(depthOffset(0)).toBeCloseTo(0, 6);
    expect(depthOffset(1)).toBeCloseTo(1, 6);
  });
});

describe('placeCell', () => {
  const layout = computeLayout(1024, 768);

  it('puts every cell inside the board box', () => {
    for (let row = 0; row < BOARD.rows; row += 1) {
      const face = cellFaceSize(layout, row);
      for (let col = 0; col < BOARD.cols; col += 1) {
        const placement = placeCell(layout, col, row);
        expect(placement.x - face.width / 2).toBeGreaterThanOrEqual(layout.board.x - 0.01);
        expect(placement.x + face.width / 2).toBeLessThanOrEqual(
          layout.board.x + layout.board.width + 0.01,
        );
        expect(placement.y - face.height / 2).toBeGreaterThanOrEqual(layout.board.y - 0.01);
        expect(placement.y + face.height / 2).toBeLessThanOrEqual(
          layout.board.y + layout.board.height + 0.01,
        );
      }
    }
  });

  it('orders rows down the screen, far row first', () => {
    let previousY = -Infinity;
    for (let row = 0; row < BOARD.rows; row += 1) {
      const y = placeCell(layout, 0, row).y;
      expect(y).toBeGreaterThan(previousY);
      previousY = y;
    }
  });

  it('orders columns left to right and keeps them symmetric', () => {
    const row = BOARD.rows - 1;
    const left = placeCell(layout, 0, row);
    const right = placeCell(layout, BOARD.cols - 1, row);
    const centre = layout.board.x + layout.board.width / 2;
    expect(left.x).toBeLessThan(right.x);
    expect(centre - left.x).toBeCloseTo(right.x - centre, 5);
  });

  it('interpolates between cells for a unit mid-move', () => {
    const from = placeCell(layout, 1, 2);
    const to = placeCell(layout, 2, 2);
    const half = placeCell(layout, 1.5, 2);
    expect(half.x).toBeCloseTo((from.x + to.x) / 2, 5);
    expect(half.y).toBeCloseTo(from.y, 5);
  });

  it('interpolates across rows too, following the perspective curve', () => {
    const near = placeCell(layout, 2, 3);
    const far = placeCell(layout, 2, 2);
    const between = placeCell(layout, 2, 2.5);
    expect(between.y).toBeGreaterThan(far.y);
    expect(between.y).toBeLessThan(near.y);
    expect(between.scale).toBeGreaterThan(far.scale);
    expect(between.scale).toBeLessThan(near.scale);
  });

  it('shrinks cell faces toward the back', () => {
    const near = cellFaceSize(layout, BOARD.rows - 1);
    const far = cellFaceSize(layout, 0);
    expect(far.width).toBeLessThan(near.width);
    expect(far.height).toBeLessThan(near.height);
  });
});

/**
 * Responsive layout and board geometry.
 *
 * Pure arithmetic on numbers — no PixiJS, no DOM. That keeps the part of the
 * renderer most likely to be quietly wrong (where things end up on screen)
 * testable without a browser.
 *
 * There is no design resolution and no letterboxing. A safe rectangle is
 * derived from the actual viewport and the board is fitted into it, so a phone
 * in portrait and a monitor in landscape each get a board sized for the space
 * they have rather than the same picture with black bars attached.
 */

import { BOARD } from '../data/schema';
import { BOARD_VIEW, LAYOUT } from './config';

export type Orientation = 'portrait' | 'landscape';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly orientation: Orientation;
  /** Viewport minus the safe margin. Content stays inside this. */
  readonly safe: Rect;
  /** The board's bounding box, at its widest (nearest) row. */
  readonly board: Rect;
  /** Width of one cell on the nearest row, in CSS pixels. */
  readonly cellSize: number;
  /** Multiplier for text and other fixed-size furniture. */
  readonly uiScale: number;
}

/** Where a cell sits on screen, and how big things on it should be drawn. */
export interface CellPlacement {
  readonly x: number;
  readonly y: number;
  /** Perspective scale for this row: 1 at the near row, less further back. */
  readonly scale: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Row depth, from 0 at the far row to 1 at the near row.
 *
 * Split out because both the vertical placement and the perspective scale are
 * functions of it, and they have to agree.
 */
export function rowDepth(row: number): number {
  if (BOARD.rows <= 1) return 1;
  return row / (BOARD.rows - 1);
}

/** Horizontal scale at a given depth. The far row is narrower. */
export function depthScale(depth: number): number {
  return BOARD_VIEW.farScale + (1 - BOARD_VIEW.farScale) * depth;
}

/**
 * Vertical position at a given depth, as a fraction of board height.
 *
 * Rows bunch up toward the back. Without this the board reads as a flat grid
 * seen head-on; with it, it reads as a surface receding away from the viewer.
 */
export function depthOffset(depth: number): number {
  const k = BOARD_VIEW.rowCompression;
  return (depth * (1 + k * depth)) / (1 + k);
}

/**
 * Total height of the board box relative to one cell width.
 *
 * The near row's cell height plus the compressed spacing of the rows above it.
 */
function boardHeightInCells(): number {
  return BOARD.rows * BOARD_VIEW.cellAspect;
}

export function computeLayout(width: number, height: number): Layout {
  const orientation: Orientation =
    width / Math.max(1, height) >= LAYOUT.landscapeAspect ? 'landscape' : 'portrait';

  const margin = Math.min(width, height) * LAYOUT.safeMarginRatio;
  const safe: Rect = {
    x: margin,
    y: margin,
    width: Math.max(1, width - margin * 2),
    height: Math.max(1, height - margin * 2),
  };

  const heightShare = LAYOUT.boardHeightShare[orientation];
  const availableWidth = safe.width;
  const availableHeight = safe.height * heightShare;

  // Fit the board box into the available space, preserving its aspect.
  const cellFromWidth = availableWidth / BOARD.cols;
  const cellFromHeight = availableHeight / boardHeightInCells();
  const cellSize = clamp(
    Math.min(cellFromWidth, cellFromHeight),
    LAYOUT.minCellSize,
    LAYOUT.maxCellSize,
  );

  const boardWidth = cellSize * BOARD.cols;
  const boardHeight = cellSize * boardHeightInCells();
  const anchor = LAYOUT.boardVerticalAnchor[orientation];

  const board: Rect = {
    x: safe.x + (safe.width - boardWidth) / 2,
    // Anchored rather than centred, so portrait leaves room below the board
    // for the controls a phone needs within thumb reach.
    y: safe.y + (safe.height - boardHeight) * anchor,
    width: boardWidth,
    height: boardHeight,
  };

  const uiScale = clamp(
    cellSize / LAYOUT.referenceCellSize,
    LAYOUT.minUiScale,
    LAYOUT.maxUiScale,
  );

  return { width, height, orientation, safe, board, cellSize, uiScale };
}

/**
 * Screen position of a cell.
 *
 * Accepts fractional coordinates so a unit can be rendered part-way between
 * two cells during a move without the caller doing its own perspective maths.
 */
export function placeCell(layout: Layout, col: number, row: number): CellPlacement {
  const depth = rowDepth(row);
  const scale = depthScale(depth);
  const centreCol = (BOARD.cols - 1) / 2;

  return {
    x: layout.board.x + layout.board.width / 2 + (col - centreCol) * layout.cellSize * scale,
    y: layout.board.y + depthOffset(depth) * (layout.board.height - layout.cellSize * BOARD_VIEW.cellAspect) + (layout.cellSize * BOARD_VIEW.cellAspect) / 2,
    scale,
  };
}

/** Size of a cell's drawn face at a given row, after perspective and gap. */
export function cellFaceSize(
  layout: Layout,
  row: number,
): { width: number; height: number } {
  const scale = depthScale(rowDepth(row));
  const inset = 1 - BOARD_VIEW.cellGap;
  return {
    width: layout.cellSize * scale * inset,
    height: layout.cellSize * BOARD_VIEW.cellAspect * scale * inset,
  };
}

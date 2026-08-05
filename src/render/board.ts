/**
 * The board surface.
 *
 * Twenty cells drawn with `Graphics`, as required — and drawn *once*, into a
 * single `Graphics` object that is rebuilt only when the viewport changes
 * size. A static board costs one batched draw per frame and nothing in CPU
 * time; rebuilding its geometry every frame would cost both for no benefit,
 * since the grid never moves.
 *
 * The look is a front view rather than an isometric one: rows recede by
 * narrowing and bunching up, which reads as depth while keeping columns
 * vertical and the board scannable at a glance.
 */

import { Container, Graphics } from 'pixi.js';
import { BOARD } from '../data/schema';
import { mixColor } from './color';
import { BOARD_VIEW, COLORS } from './config';
import { cellFaceSize, depthScale, placeCell, rowDepth } from './layout';
import type { Layout } from './layout';

export class BoardView {
  readonly root = new Container();
  private readonly surface = new Graphics();

  constructor() {
    this.root.addChild(this.surface);
  }

  /** Rebuilds the grid for a new layout. Called on resize, not per frame. */
  resize(layout: Layout): void {
    const g = this.surface;
    g.clear();

    const cornerScale = BOARD_VIEW.cellCornerRatio;
    const lineWidth = Math.max(1, layout.cellSize * BOARD_VIEW.cellLineRatio);

    // Far rows first, so nearer rows overlap them the way depth implies.
    for (let row = 0; row < BOARD.rows; row += 1) {
      const depth = rowDepth(row);
      const face = cellFaceSize(layout, row);
      const corner = Math.min(face.width, face.height) * cornerScale;

      // Row tint marks whose half of the board this is, without a label.
      const isPlayerRow = (BOARD.playerRows as readonly number[]).includes(row);
      const zone = isPlayerRow ? COLORS.playerZone : COLORS.enemyZone;
      const surfaceColor = mixColor(COLORS.cellFarFill, COLORS.cellNearFill, depth);

      for (let col = 0; col < BOARD.cols; col += 1) {
        const centre = placeCell(layout, col, row);
        const x = centre.x - face.width / 2;
        const y = centre.y - face.height / 2;

        g.roundRect(x, y, face.width, face.height, corner)
          .fill({ color: mixColor(surfaceColor, zone, 0.45) })
          .stroke({ width: lineWidth, color: COLORS.cellLine, alpha: 0.8 });
      }
    }

    // A brighter rule along the halfway line, so the two halves read apart.
    const frontRow = (BOARD.enemyRows as readonly number[]).length - 1;
    const divider = placeCell(layout, 0, frontRow);
    const dividerFace = cellFaceSize(layout, frontRow);
    const halfWidth = (layout.cellSize * BOARD.cols * depthScale(rowDepth(frontRow))) / 2;
    const dividerY = divider.y + dividerFace.height / 2 + lineWidth * 2;
    g.moveTo(layout.board.x + layout.board.width / 2 - halfWidth, dividerY)
      .lineTo(layout.board.x + layout.board.width / 2 + halfWidth, dividerY)
      .stroke({ width: lineWidth * 1.5, color: COLORS.cellLine, alpha: 0.9 });
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

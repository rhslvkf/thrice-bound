/**
 * Placement.
 *
 * Owns the tray of cards, the units already on the board, dragging between the
 * two, and the merge button. Pointer events are used throughout rather than
 * mouse or touch events, so a finger and a cursor take exactly the same path
 * through this file.
 *
 * A drag is resolved by *where it was dropped*, never by where it started.
 * That is what lets one gesture mean three things — place into an empty cell,
 * swap two occupied ones, or fail and spring home — without three code paths
 * for picking things up.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { GameData, UnitDef } from '../../data/schema';
import { BOARD } from '../../data/schema';
import type { Atlas } from '../atlas';
import { COLORS } from '../config';
import { cellFaceSize, placeCell } from '../layout';
import type { Layout } from '../layout';
import type { TextureRegistry } from '../textures';
import { tuning } from '../tuning';
import { Easings } from '../tween';
import type { TweenManager } from '../tween';
import { BoardComposition } from './BoardComposition';
import type { MergeOpportunity, Slot } from './BoardComposition';
import { UnitCard } from './UnitCard';

/** Tray geometry, as fractions of a cell. */
const TRAY = {
  cardWidthRatio: 0.92,
  gapRatio: 0.16,
  /** Distance below the board to the tray's centre line, in cells. */
  offsetRatio: 1.62,
} as const;

/** Button geometry, in cell fractions. */
const BUTTON = {
  widthRatio: 2.4,
  heightRatio: 0.56,
  cornerRatio: 0.16,
  textRatio: 0.19,
  /** Distance below the board to the button row's centre line, in cells. */
  gapRatio: 0.48,
} as const;

/** How many units the tray offers. No shop economy exists yet to size it. */
const TRAY_SIZE = 5;

interface TrayEntry {
  readonly card: UnitCard;
  def: UnitDef | null;
}

interface DragState {
  readonly origin: { x: number; y: number };
  readonly source: { kind: 'tray'; index: number } | { kind: 'board'; slot: Slot };
  readonly def: UnitDef;
  readonly node: Container;
  pointerId: number;
}

export interface PrepCallbacks {
  /** A merge was requested. The scene runs the sequence. */
  readonly onMerge: (opportunity: MergeOpportunity) => void;
  /** The player is done placing. */
  readonly onFight: () => void;
  /** The board changed, so the scene should rebuild its unit views. */
  readonly onBoardChanged: () => void;
}

export class PrepController {
  readonly root = new Container();

  private readonly trayLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly dragLayer = new Container();
  private readonly highlight = new Graphics();

  private readonly tray: TrayEntry[] = [];
  private readonly mergeButton: Container;
  private readonly mergeLabel: Text;
  private readonly mergeBackground = new Graphics();
  private readonly fightButton: Container;
  private readonly fightLabel: Text;
  private readonly fightBackground = new Graphics();

  private readonly ghost: UnitCard;
  private drag: DragState | null = null;
  private hovered: Slot | null = null;
  private layout: Layout;
  private opportunities: MergeOpportunity[] = [];
  private enabled = false;

  constructor(
    private readonly data: GameData,
    atlas: Atlas,
    private readonly textures: TextureRegistry,
    private readonly tweens: TweenManager,
    readonly board: BoardComposition,
    private readonly callbacks: PrepCallbacks,
    layout: Layout,
  ) {
    this.layout = layout;

    for (let i = 0; i < TRAY_SIZE; i += 1) {
      const card = new UnitCard(atlas);
      card.root.eventMode = 'static';
      card.root.cursor = 'grab';
      const index = i;
      card.root.on('pointerdown', (event: FederatedPointerEvent) =>
        this.beginTrayDrag(index, event),
      );
      this.trayLayer.addChild(card.root);
      this.tray.push({ card, def: null });
    }

    this.mergeLabel = new Text({
      text: 'MERGE',
      style: { fill: COLORS.buttonAccent, fontSize: 16, fontFamily: 'system-ui', letterSpacing: 2 },
    });
    this.mergeLabel.anchor.set(0.5);
    this.mergeButton = new Container();
    this.mergeButton.addChild(this.mergeBackground, this.mergeLabel);
    this.mergeButton.eventMode = 'static';
    this.mergeButton.cursor = 'pointer';
    this.mergeButton.visible = false;
    this.mergeButton.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.requestMerge();
    });

    this.fightLabel = new Text({
      text: 'FIGHT',
      style: { fill: COLORS.text, fontSize: 16, fontFamily: 'system-ui', letterSpacing: 2 },
    });
    this.fightLabel.anchor.set(0.5);
    this.fightButton = new Container();
    this.fightButton.addChild(this.fightBackground, this.fightLabel);
    this.fightButton.eventMode = 'static';
    this.fightButton.cursor = 'pointer';
    this.fightButton.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (this.enabled) this.callbacks.onFight();
    });

    this.ghost = new UnitCard(atlas);
    this.ghost.root.visible = false;
    this.ghost.root.alpha = 0.92;
    this.dragLayer.addChild(this.ghost.root);
    this.dragLayer.eventMode = 'none';

    this.overlayLayer.addChild(this.mergeButton, this.fightButton);
    this.root.addChild(this.highlight, this.trayLayer, this.overlayLayer, this.dragLayer);
  }

  /** Fills every slot. Used when the phase starts. */
  refillTray(pick: () => UnitDef): void {
    for (const entry of this.tray) this.fill(entry, pick);
  }

  /**
   * Refills whatever has been taken.
   *
   * Standing in for a shop: without a restock the tray runs dry after five
   * placements and the board can never reach three of a kind, which is the
   * one thing the prep phase exists to let you do.
   */
  refillEmpty(pick: () => UnitDef): void {
    for (const entry of this.tray) {
      if (entry.def === null) this.fill(entry, pick);
    }
  }

  private fill(entry: TrayEntry, pick: () => UnitDef): void {
    entry.def = pick();
    entry.card.bind(entry.def, this.textures.resolve(entry.def), COLORS.team.player);
    entry.card.root.visible = true;
    entry.card.root.alpha = 1;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.visible = enabled;
    if (!enabled) this.cancelDrag();
  }

  /** Recomputes which merges are available and shows or hides the button. */
  refreshMerges(): void {
    this.opportunities = this.board.mergeOpportunities();
    const first = this.opportunities[0];
    this.mergeButton.visible = first !== undefined;
    if (first !== undefined) {
      this.mergeLabel.text = `MERGE ${first.name.toUpperCase()}`;
      this.drawButtons();
    }
  }

  resize(layout: Layout): void {
    this.layout = layout;
    const cell = layout.cellSize;
    const cardWidth = cell * TRAY.cardWidthRatio;
    const gap = cell * TRAY.gapRatio;
    const span = this.tray.length * cardWidth + (this.tray.length - 1) * gap;
    const y = layout.board.y + layout.board.height + cell * TRAY.offsetRatio;

    this.tray.forEach((entry, index) => {
      entry.card.setSize(cardWidth);
      entry.card.root.position.set(
        layout.width / 2 - span / 2 + cardWidth / 2 + index * (cardWidth + gap),
        y,
      );
    });

    this.ghost.setSize(cardWidth);

    const buttonY = layout.board.y + layout.board.height + cell * BUTTON.gapRatio;
    const buttonWidth = cell * BUTTON.widthRatio;
    this.mergeButton.position.set(layout.width / 2 - buttonWidth / 2 - cell * 0.2, buttonY);
    this.fightButton.position.set(layout.width / 2 + buttonWidth / 2 + cell * 0.2, buttonY);
    this.mergeLabel.style.fontSize = cell * BUTTON.textRatio;
    this.fightLabel.style.fontSize = cell * BUTTON.textRatio;
    this.drawButtons();
  }

  // -------------------------------------------------------------------------
  // Dragging
  // -------------------------------------------------------------------------

  /** Starts a drag from a board unit. Called by the scene, which owns the views. */
  beginBoardDrag(slot: Slot, event: FederatedPointerEvent): void {
    if (!this.enabled || this.drag !== null) return;
    const unitId = this.board.at(slot.col, slot.row);
    if (unitId === null) return;
    const def = this.data.units.get(unitId);
    if (def === undefined) return;

    const placement = placeCell(this.layout, slot.col, slot.row);
    this.startDrag(
      { kind: 'board', slot },
      def,
      { x: placement.x, y: placement.y },
      event,
    );
  }

  private beginTrayDrag(index: number, event: FederatedPointerEvent): void {
    if (!this.enabled || this.drag !== null) return;
    const entry = this.tray[index];
    if (entry?.def == null) return;

    this.startDrag(
      { kind: 'tray', index },
      entry.def,
      { x: entry.card.root.position.x, y: entry.card.root.position.y },
      event,
    );
    entry.card.root.alpha = 0.25;
  }

  private startDrag(
    source: DragState['source'],
    def: UnitDef,
    origin: { x: number; y: number },
    event: FederatedPointerEvent,
  ): void {
    event.stopPropagation();
    this.ghost.bind(def, this.textures.resolve(def), COLORS.team.player);
    this.ghost.root.visible = true;
    this.ghost.root.position.set(origin.x, origin.y);
    this.ghost.root.scale.set(1);

    this.drag = { origin, source, def, node: this.ghost.root, pointerId: event.pointerId };

    // The lift is what tells a finger the pick-up registered, on a screen with
    // no cursor to change.
    this.tweens.to({
      durationMs: tuning.drag.liftMs,
      easing: Easings.easeOutCubic,
      onUpdate: (t) => {
        this.ghost.root.scale.set(1 + (tuning.drag.liftScale - 1) * t);
      },
    });
    this.moveDrag(event.global.x, event.global.y);
  }

  /** Called by the scene's global pointermove. */
  moveDrag(x: number, y: number): void {
    if (this.drag === null) return;
    this.ghost.root.position.set(x, y);
    this.hovered = this.cellAt(x, y);
    this.drawHighlight();
  }

  /** Called by the scene's global pointerup. Resolves the drop. */
  endDrag(x: number, y: number): void {
    const drag = this.drag;
    if (drag === null) return;

    const target = this.cellAt(x, y);
    this.hovered = null;
    this.highlight.clear();

    if (target !== null && this.isLegalDrop(drag, target)) {
      // Retired before the board callback runs: the callback restocks empty
      // tray slots, and this drag's slot is not empty until it is finished.
      this.finishDrag(drag, true);
      this.applyDrop(drag, target);
      return;
    }
    // Illegal or off-board: spring home. Elastic rather than linear, because a
    // rejected drop should feel like the card refusing to stay put.
    this.springBack(drag);
  }

  cancelDrag(): void {
    const drag = this.drag;
    if (drag === null) return;
    this.springBack(drag);
  }

  private springBack(drag: DragState): void {
    const from = { x: this.ghost.root.position.x, y: this.ghost.root.position.y };
    this.tweens.to({
      durationMs: tuning.drag.returnMs,
      easing: Easings.easeOutElastic,
      onUpdate: (t) => {
        this.ghost.root.position.set(
          from.x + (drag.origin.x - from.x) * t,
          from.y + (drag.origin.y - from.y) * t,
        );
        this.ghost.root.scale.set(tuning.drag.liftScale + (1 - tuning.drag.liftScale) * t);
      },
      onComplete: () => this.finishDrag(drag, false),
    });
    this.drag = null;
  }

  private finishDrag(drag: DragState, consumed: boolean): void {
    this.ghost.root.visible = false;
    this.ghost.root.scale.set(1);
    this.drag = null;
    this.hovered = null;
    this.highlight.clear();

    if (drag.source.kind === 'tray') {
      const entry = this.tray[drag.source.index];
      if (entry !== undefined) {
        entry.card.root.alpha = 1;
        if (consumed) {
          entry.def = null;
          entry.card.root.visible = false;
        }
      }
    }
  }

  /**
   * Whether a drop is allowed.
   *
   * Board cells only, player half only. A tray card needs an empty cell; a
   * board unit may land on an occupied one, which swaps them.
   */
  private isLegalDrop(drag: DragState, target: Slot): boolean {
    if (!BoardComposition.isPlayerCell(target.col, target.row)) return false;
    if (drag.source.kind === 'board') return true;
    return this.board.at(target.col, target.row) === null;
  }

  private applyDrop(drag: DragState, target: Slot): void {
    if (drag.source.kind === 'tray') {
      this.board.place(target.col, target.row, drag.def.id);
    } else {
      this.board.swap(drag.source.slot, target);
    }
    this.callbacks.onBoardChanged();
    this.refreshMerges();
  }

  // -------------------------------------------------------------------------

  /** The cell under a screen point, or `null` if the point is off the board. */
  private cellAt(x: number, y: number): Slot | null {
    for (let row = 0; row < BOARD.rows; row += 1) {
      const face = cellFaceSize(this.layout, row);
      for (let col = 0; col < BOARD.cols; col += 1) {
        const centre = placeCell(this.layout, col, row);
        if (
          Math.abs(x - centre.x) <= face.width / 2 &&
          Math.abs(y - centre.y) <= face.height / 2
        ) {
          return { col, row };
        }
      }
    }
    return null;
  }

  /**
   * Marks every cell as a legal or illegal target while a drag is in flight.
   *
   * Showing both states, rather than only the legal ones, answers the question
   * a player actually has mid-drag: not "where may this go" but "why will this
   * not go there".
   */
  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    const drag = this.drag;
    if (drag === null) return;

    for (let row = 0; row < BOARD.rows; row += 1) {
      const face = cellFaceSize(this.layout, row);
      for (let col = 0; col < BOARD.cols; col += 1) {
        const slot = { col, row };
        const legal = this.isLegalDrop(drag, slot);
        const centre = placeCell(this.layout, col, row);
        const isHovered =
          this.hovered !== null && this.hovered.col === col && this.hovered.row === row;

        g.roundRect(
          centre.x - face.width / 2,
          centre.y - face.height / 2,
          face.width,
          face.height,
          Math.min(face.width, face.height) * 0.14,
        );
        if (legal) {
          g.fill({
            color: COLORS.dropValid,
            alpha: (isHovered ? 0.34 : 0.12) * tuning.drag.validAlpha,
          });
          if (isHovered) {
            g.stroke({ width: Math.max(2, face.width * 0.03), color: COLORS.dropValid });
          }
        } else {
          // Illegal cells are darkened rather than outlined, so the legal ones
          // are what the eye lands on.
          g.fill({ color: 0x000000, alpha: 0.55 * (1 - tuning.drag.invalidAlpha) + 0.2 });
          if (isHovered) {
            g.stroke({ width: Math.max(2, face.width * 0.03), color: COLORS.dropInvalid });
          }
        }
      }
    }
  }

  private requestMerge(): void {
    const opportunity = this.opportunities[0];
    if (opportunity === undefined) return;
    this.callbacks.onMerge(opportunity);
  }

  private drawButtons(): void {
    const cell = this.layout.cellSize;
    const width = cell * BUTTON.widthRatio;
    const height = cell * BUTTON.heightRatio;
    const corner = cell * BUTTON.cornerRatio;

    for (const [graphics, accent] of [
      [this.mergeBackground, COLORS.buttonAccent],
      [this.fightBackground, COLORS.cardBorder],
    ] as const) {
      graphics.clear();
      graphics
        .roundRect(-width / 2, -height / 2, width, height, corner)
        .fill({ color: COLORS.buttonFill })
        .stroke({ width: Math.max(1.5, cell * 0.02), color: accent, alpha: 0.9 });
    }
  }

  destroy(): void {
    for (const entry of this.tray) entry.card.destroy();
    this.ghost.destroy();
    this.root.destroy({ children: true });
  }
}

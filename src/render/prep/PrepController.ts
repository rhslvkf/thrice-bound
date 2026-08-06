/**
 * The shop and the board, before the fight.
 *
 * One controller for both, because they are one gesture: a card is bought by
 * dragging it onto a cell, and a unit is repositioned by dragging it to
 * another. Splitting the shop out would split a single drag lifecycle across
 * two files.
 *
 * Pointer events throughout rather than mouse or touch events, so a finger and
 * a cursor take exactly the same path. A drag is resolved by *where it was
 * dropped*, never by where it started — that is what lets one gesture mean four
 * things (buy into an empty cell, swap two occupied ones, sell, or fail and
 * spring home) without four ways to pick something up.
 *
 * This file decides nothing. Every action goes out through {@link PrepCallbacks}
 * to the scene, which asks `src/core/run` and gets back a new state or a
 * refusal. The controller then re-reads that state. It never edits a board.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { GameData, UnitDef } from '../../data/schema';
import { BOARD } from '../../data/schema';
import {
  isPlayerCell,
  mergeOpportunities,
  priceOf,
  rerollCost,
  sellValue,
  unitAt,
} from '../../core/run/index';
import type { Cell, MergeOpportunity, RunState } from '../../core/run/index';
import type { Atlas } from '../atlas';
import { COLORS } from '../config';
import { cellFaceSize, placeCell } from '../layout';
import type { Layout } from '../layout';
import type { TextureRegistry } from '../textures';
import { tuning } from '../tuning';
import { Easings } from '../tween';
import type { TweenManager } from '../tween';
import { UnitCard } from './UnitCard';

/** Shop row geometry, as fractions of a cell. */
const SHOP = {
  cardWidthRatio: 0.92,
  gapRatio: 0.16,
  /** Distance below the board to the row's centre line, in cells. */
  offsetRatio: 1.66,
  priceRatio: 0.15,
  priceOffsetRatio: 0.62,
  lockRatio: 0.13,
  lockOffsetRatio: -0.56,
} as const;

/** Button geometry, in cell fractions. */
const BUTTON = {
  widthRatio: 1.9,
  heightRatio: 0.5,
  cornerRatio: 0.14,
  textRatio: 0.17,
  /** Distance below the board to the button row's centre line, in cells. */
  gapRatio: 0.46,
  /** Horizontal spacing between adjacent buttons, in cells. */
  spacingRatio: 0.16,
} as const;

interface ShopEntry {
  readonly card: UnitCard;
  readonly price: Text;
  readonly lock: Graphics;
  def: UnitDef | null;
  affordable: boolean;
}

interface DragState {
  readonly origin: { x: number; y: number };
  readonly source: { kind: 'shop'; index: number } | { kind: 'board'; cell: Cell };
  readonly def: UnitDef;
  pointerId: number;
}

export interface PrepCallbacks {
  /** Buy a shop slot. `target` is the cell it was dropped on, if any. */
  readonly onBuy: (slotIndex: number, target: Cell | null) => void;
  readonly onMove: (from: Cell, to: Cell) => void;
  readonly onSell: (cell: Cell) => void;
  readonly onToggleLock: (slotIndex: number) => void;
  readonly onReroll: () => void;
  readonly onMerge: (opportunity: MergeOpportunity) => void;
  readonly onFight: () => void;
}

/** A simple pill button with a label. */
class PillButton {
  readonly root = new Container();
  private readonly background = new Graphics();
  private readonly label: Text;

  constructor(text: string, accent: number, onPress: () => void) {
    this.label = new Text({
      text,
      style: { fill: COLORS.text, fontSize: 16, fontFamily: 'system-ui', letterSpacing: 2 },
    });
    this.label.anchor.set(0.5);
    this.root.addChild(this.background, this.label);
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
    this.root.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      onPress();
    });
    this.accent = accent;
  }

  private accent: number;
  private enabled = true;

  setText(text: string): void {
    this.label.text = text;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.alpha = enabled ? 1 : 0.4;
    this.root.eventMode = enabled ? 'static' : 'none';
    this.root.cursor = enabled ? 'pointer' : 'default';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  resize(cell: number): void {
    const width = cell * BUTTON.widthRatio;
    const height = cell * BUTTON.heightRatio;
    this.label.style.fontSize = cell * BUTTON.textRatio;
    this.background.clear();
    this.background
      .roundRect(-width / 2, -height / 2, width, height, cell * BUTTON.cornerRatio)
      .fill({ color: COLORS.buttonFill })
      .stroke({ width: Math.max(1.5, cell * 0.02), color: this.accent, alpha: 0.9 });
  }

  get width(): number {
    return this.background.width;
  }
}

export class PrepController {
  readonly root = new Container();

  private readonly shopLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly dragLayer = new Container();
  private readonly highlight = new Graphics();
  private readonly sellZone = new Graphics();
  private readonly sellLabel: Text;

  private readonly shop: ShopEntry[] = [];
  private readonly mergeButton: PillButton;
  private readonly fightButton: PillButton;
  private readonly rerollButton: PillButton;

  private readonly ghost: UnitCard;
  private drag: DragState | null = null;
  private hovered: Cell | null = null;
  private overSell = false;
  private layout: Layout;
  private opportunities: MergeOpportunity[] = [];
  private state: RunState | null = null;
  private enabled = false;

  constructor(
    private readonly data: GameData,
    atlas: Atlas,
    private readonly textures: TextureRegistry,
    private readonly tweens: TweenManager,
    private readonly callbacks: PrepCallbacks,
    layout: Layout,
  ) {
    this.layout = layout;

    for (let i = 0; i < data.run.rules.shopSlots; i += 1) {
      const card = new UnitCard(atlas);
      card.root.eventMode = 'static';
      card.root.cursor = 'grab';
      const index = i;
      card.root.on('pointerdown', (event: FederatedPointerEvent) =>
        this.beginShopDrag(index, event),
      );

      const price = new Text({
        text: '',
        style: { fill: COLORS.gold, fontSize: 13, fontFamily: 'system-ui', fontWeight: 'bold' },
      });
      price.anchor.set(0.5);

      // The lock is a separate hit target on the card's top edge: locking and
      // dragging are different intents, and a long-press to disambiguate them
      // would be a worse answer than a second button.
      const lock = new Graphics();
      lock.eventMode = 'static';
      lock.cursor = 'pointer';
      lock.on('pointerdown', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        if (this.enabled) this.callbacks.onToggleLock(index);
      });

      this.shopLayer.addChild(card.root, price, lock);
      this.shop.push({ card, price, lock, def: null, affordable: true });
    }

    this.mergeButton = new PillButton('MERGE', COLORS.buttonAccent, () => this.requestMerge());
    this.fightButton = new PillButton('FIGHT', COLORS.cardBorder, () => {
      if (this.enabled) this.callbacks.onFight();
    });
    this.rerollButton = new PillButton('REROLL', COLORS.cardBorder, () => {
      if (this.enabled) this.callbacks.onReroll();
    });
    this.mergeButton.root.visible = false;

    this.sellLabel = new Text({
      text: '',
      style: { fill: COLORS.sellZone, fontSize: 14, fontFamily: 'system-ui', letterSpacing: 2 },
    });
    this.sellLabel.anchor.set(0.5);
    this.sellLabel.visible = false;

    this.ghost = new UnitCard(atlas);
    this.ghost.root.visible = false;
    this.ghost.root.alpha = 0.92;
    this.dragLayer.addChild(this.ghost.root);
    this.dragLayer.eventMode = 'none';

    this.overlayLayer.addChild(
      this.mergeButton.root,
      this.fightButton.root,
      this.rerollButton.root,
    );
    this.root.addChild(
      this.highlight,
      this.sellZone,
      this.sellLabel,
      this.shopLayer,
      this.overlayLayer,
      this.dragLayer,
    );
  }

  /**
   * Re-reads run state.
   *
   * The single entry point for "something changed". Called after every accepted
   * action rather than per frame, so text is re-rasterised only when its value
   * actually moved.
   */
  sync(state: RunState): void {
    this.state = state;

    state.shop.forEach((slot, index) => {
      const entry = this.shop[index];
      if (entry === undefined) return;

      const def = slot.unitId === null ? undefined : this.data.units.get(slot.unitId);
      entry.def = def ?? null;
      entry.card.root.visible = def !== undefined;
      entry.price.visible = def !== undefined;
      entry.lock.visible = def !== undefined;

      if (def === undefined) return;
      const cost = priceOf(this.data, def.id);
      entry.affordable = state.gold >= cost;
      entry.card.bind(def, this.textures.resolve(def), COLORS.team.player);
      // Unaffordable cards stay visible and dim rather than disappearing: what
      // is on the shelf is information even when the purse cannot reach it.
      entry.card.root.alpha = entry.affordable ? 1 : 0.42;
      entry.card.root.cursor = entry.affordable ? 'grab' : 'not-allowed';
      entry.price.text = String(cost);
      entry.price.style.fill = entry.affordable ? COLORS.gold : COLORS.textDim;
    });

    const cost = rerollCost(this.data, state);
    this.rerollButton.setText(cost === 0 ? 'REROLL · FREE' : `REROLL · ${cost}`);
    this.rerollButton.setEnabled(state.phase === 'shop' && (cost === 0 || state.gold >= cost));
    this.fightButton.setEnabled(state.board.length > 0);

    this.refreshMerges();
    this.resize(this.layout);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.visible = enabled;
    if (!enabled) this.cancelDrag();
  }

  /** Recomputes which merges are available and shows or hides the button. */
  refreshMerges(): void {
    const state = this.state;
    this.opportunities = state === null ? [] : mergeOpportunities(this.data, state.board);
    const first = this.opportunities[0];
    this.mergeButton.root.visible = first !== undefined;
    if (first !== undefined) this.mergeButton.setText(`MERGE ${first.name.toUpperCase()}`);
  }

  resize(layout: Layout): void {
    this.layout = layout;
    const cell = layout.cellSize;
    const cardWidth = cell * SHOP.cardWidthRatio;
    const gap = cell * SHOP.gapRatio;
    const count = this.shop.length;
    const span = count * cardWidth + (count - 1) * gap;
    const y = layout.board.y + layout.board.height + cell * SHOP.offsetRatio;

    this.shop.forEach((entry, index) => {
      const x = layout.width / 2 - span / 2 + cardWidth / 2 + index * (cardWidth + gap);
      entry.card.setSize(cardWidth);
      entry.card.root.position.set(x, y);

      const height = entry.card.size.height;
      entry.price.style.fontSize = cell * SHOP.priceRatio;
      entry.price.position.set(x, y + height * SHOP.priceOffsetRatio);

      const lockSize = cell * SHOP.lockRatio;
      const lockY = y + height * SHOP.lockOffsetRatio;
      this.drawLock(entry, x, lockY, lockSize, index);
    });

    this.ghost.setSize(cardWidth);

    const buttonY = layout.board.y + layout.board.height + cell * BUTTON.gapRatio;
    const step = cell * (BUTTON.widthRatio + BUTTON.spacingRatio);
    for (const button of [this.mergeButton, this.fightButton, this.rerollButton]) {
      button.resize(cell);
    }
    // Merge only appears when it is possible, so the row is centred on whatever
    // is actually showing rather than leaving a hole where it would be.
    const visible = [this.rerollButton, this.mergeButton, this.fightButton].filter(
      (button) => button.root.visible,
    );
    visible.forEach((button, index) => {
      button.root.position.set(
        layout.width / 2 - ((visible.length - 1) * step) / 2 + index * step,
        buttonY,
      );
    });

    this.drawSellZone();
  }

  private drawLock(entry: ShopEntry, x: number, y: number, size: number, index: number): void {
    const locked = this.state?.shop[index]?.locked === true;
    entry.lock.clear();
    entry.lock.position.set(x, y);
    entry.lock
      .roundRect(-size / 2, -size / 2, size, size, size * 0.25)
      .fill({ color: locked ? COLORS.locked : COLORS.cardFill })
      .stroke({ width: Math.max(1, size * 0.12), color: locked ? COLORS.locked : COLORS.cardBorder });
  }

  // -------------------------------------------------------------------------
  // Dragging
  // -------------------------------------------------------------------------

  /** Starts a drag from a board unit. Called by the scene, which owns the views. */
  beginBoardDrag(cell: Cell, event: FederatedPointerEvent): void {
    const state = this.state;
    if (!this.enabled || this.drag !== null || state === null) return;

    const unitId = unitAt(state.board, cell.col, cell.row);
    if (unitId === null) return;
    const def = this.data.units.get(unitId);
    if (def === undefined) return;

    const placement = placeCell(this.layout, cell.col, cell.row);
    this.startDrag({ kind: 'board', cell }, def, { x: placement.x, y: placement.y }, event);
  }

  private beginShopDrag(index: number, event: FederatedPointerEvent): void {
    if (!this.enabled || this.drag !== null) return;
    const entry = this.shop[index];
    if (entry?.def == null || !entry.affordable) return;

    this.startDrag(
      { kind: 'shop', index },
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

    this.drag = { origin, source, def, pointerId: event.pointerId };

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
    this.overSell = this.drag.source.kind === 'board' && this.isOverSellZone(x, y);
    this.drawHighlight();
    this.drawSellZone();
  }

  /** Called by the scene's global pointerup. Resolves the drop. */
  endDrag(x: number, y: number): void {
    const drag = this.drag;
    if (drag === null) return;

    const target = this.cellAt(x, y);
    const sold = drag.source.kind === 'board' && this.isOverSellZone(x, y);
    this.hovered = null;
    this.overSell = false;
    this.highlight.clear();

    if (sold) {
      this.finishDrag(drag, false);
      this.callbacks.onSell(drag.source.kind === 'board' ? drag.source.cell : { col: 0, row: 0 });
      return;
    }

    if (target !== null && this.isLegalDrop(drag, target)) {
      // Retired before the callback runs: the callback re-syncs from a new run
      // state, and this drag's slot is not free until it is finished.
      this.finishDrag(drag, true);
      if (drag.source.kind === 'shop') this.callbacks.onBuy(drag.source.index, target);
      else this.callbacks.onMove(drag.source.cell, target);
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
    this.overSell = false;
    this.highlight.clear();
    this.drawSellZone();

    if (drag.source.kind === 'shop') {
      const entry = this.shop[drag.source.index];
      if (entry !== undefined) {
        entry.card.root.alpha = consumed ? 1 : entry.affordable ? 1 : 0.42;
      }
    }
  }

  /**
   * Whether a drop is allowed.
   *
   * Board cells only, player half only. A shop card needs an empty cell; a
   * board unit may land on an occupied one, which swaps them.
   */
  private isLegalDrop(drag: DragState, target: Cell): boolean {
    if (!isPlayerCell(target.col, target.row)) return false;
    const state = this.state;
    if (state === null) return false;
    if (drag.source.kind === 'board') return true;
    return unitAt(state.board, target.col, target.row) === null;
  }

  // -------------------------------------------------------------------------

  /** The cell under a screen point, or `null` if the point is off the board. */
  private cellAt(x: number, y: number): Cell | null {
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

  /** The sell strip sits over the shop row, which is dead space during a drag. */
  private sellBounds(): { x: number; y: number; width: number; height: number } {
    const cell = this.layout.cellSize;
    const height = cell * 0.9;
    return {
      x: this.layout.safe.x,
      y: this.layout.board.y + this.layout.board.height + cell * (SHOP.offsetRatio - 0.5),
      width: this.layout.safe.width,
      height,
    };
  }

  private isOverSellZone(x: number, y: number): boolean {
    const bounds = this.sellBounds();
    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  }

  private drawSellZone(): void {
    const g = this.sellZone;
    g.clear();
    const drag = this.drag;
    const showing = drag !== null && drag.source.kind === 'board';
    this.sellLabel.visible = showing;
    if (!showing || drag === null || drag.source.kind !== 'board') return;

    const state = this.state;
    if (state === null) return;
    const unitId = unitAt(state.board, drag.source.cell.col, drag.source.cell.row);
    const refund = unitId === null ? 0 : sellValue(this.data, unitId);

    const bounds = this.sellBounds();
    g.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, this.layout.cellSize * 0.1)
      .fill({ color: COLORS.sellZone, alpha: this.overSell ? 0.3 : 0.1 })
      .stroke({
        width: Math.max(1.5, this.layout.cellSize * 0.02),
        color: COLORS.sellZone,
        alpha: this.overSell ? 1 : 0.5,
      });

    this.sellLabel.text = `SELL  +${refund}`;
    this.sellLabel.style.fontSize = this.layout.cellSize * 0.2;
    this.sellLabel.position.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
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
        const cell = { col, row };
        const legal = this.isLegalDrop(drag, cell);
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
    if (opportunity === undefined || !this.enabled) return;
    this.callbacks.onMerge(opportunity);
  }

  destroy(): void {
    for (const entry of this.shop) entry.card.destroy();
    this.ghost.destroy();
    this.root.destroy({ children: true });
  }
}

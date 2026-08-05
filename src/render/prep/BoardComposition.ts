/**
 * What the player has on the board before the fight.
 *
 * **This belongs in `src/core` and is here on purpose, for now.** Board
 * composition decides the battle, so it is game state, not presentation — but
 * core has no run state yet (no gold, no shop, no rounds), and the brief was
 * not to change core. So the placement model lives here as a plain data holder
 * with no PixiJS in it, ready to move across once run state exists.
 *
 * It is deliberately dumb: cells in, deployments out. The merge *rules* it
 * enforces come from `src/data` — which units combine, and what they may
 * become — so nothing about the merge tree is duplicated here.
 */

import type { Deployment } from '../../core/battle/index';
import { BOARD, MERGE_COST_IN_COPIES } from '../../data/schema';
import type { GameData, UnitDef } from '../../data/schema';

export interface Slot {
  readonly col: number;
  readonly row: number;
}

/** A merge the player could perform right now. */
export interface MergeOpportunity {
  readonly unitId: string;
  readonly name: string;
  /** The cells holding the copies, in board order. */
  readonly slots: readonly Slot[];
  /** Upgrade candidates. The choice this game is built around. */
  readonly options: readonly UnitDef[];
}

const key = (col: number, row: number): string => `${col},${row}`;

export class BoardComposition {
  private readonly cells = new Map<string, string>();

  constructor(private readonly data: GameData) {}

  /** Cells the player may use. Everything else is the enemy's half. */
  static isPlayerCell(col: number, row: number): boolean {
    return (
      col >= 0 &&
      col < BOARD.cols &&
      (BOARD.playerRows as readonly number[]).includes(row)
    );
  }

  static playerSlots(): Slot[] {
    const slots: Slot[] = [];
    for (const row of BOARD.playerRows) {
      for (let col = 0; col < BOARD.cols; col += 1) slots.push({ col, row });
    }
    return slots;
  }

  get size(): number {
    return this.cells.size;
  }

  get capacity(): number {
    return BOARD.cols * BOARD.playerRows.length;
  }

  get isFull(): boolean {
    return this.size >= this.capacity;
  }

  at(col: number, row: number): string | null {
    return this.cells.get(key(col, row)) ?? null;
  }

  place(col: number, row: number, unitId: string): void {
    if (!BoardComposition.isPlayerCell(col, row)) {
      throw new Error(`cell (${col}, ${row}) is not on the player's half`);
    }
    this.cells.set(key(col, row), unitId);
  }

  remove(col: number, row: number): string | null {
    const existing = this.at(col, row);
    if (existing !== null) this.cells.delete(key(col, row));
    return existing;
  }

  /** Exchanges the contents of two cells. Either may be empty. */
  swap(a: Slot, b: Slot): void {
    const first = this.at(a.col, a.row);
    const second = this.at(b.col, b.row);
    this.cells.delete(key(a.col, a.row));
    this.cells.delete(key(b.col, b.row));
    if (second !== null) this.cells.set(key(a.col, a.row), second);
    if (first !== null) this.cells.set(key(b.col, b.row), first);
  }

  /** The first free cell in board order, or `null` when full. */
  firstFreeSlot(): Slot | null {
    for (const slot of BoardComposition.playerSlots()) {
      if (this.at(slot.col, slot.row) === null) return slot;
    }
    return null;
  }

  occupied(): { slot: Slot; unitId: string }[] {
    return BoardComposition.playerSlots()
      .map((slot) => ({ slot, unitId: this.at(slot.col, slot.row) }))
      .filter((entry): entry is { slot: Slot; unitId: string } => entry.unitId !== null);
  }

  /**
   * Merges available right now.
   *
   * A merge needs `MERGE_COST_IN_COPIES` of the same unit on the board, and
   * the unit must have somewhere to go — tier 3 is terminal, so three of those
   * are just three of those.
   */
  mergeOpportunities(): MergeOpportunity[] {
    const byUnit = new Map<string, Slot[]>();
    for (const { slot, unitId } of this.occupied()) {
      const slots = byUnit.get(unitId) ?? [];
      slots.push(slot);
      byUnit.set(unitId, slots);
    }

    const opportunities: MergeOpportunity[] = [];
    for (const [unitId, slots] of byUnit) {
      if (slots.length < MERGE_COST_IN_COPIES) continue;
      const def = this.data.units.get(unitId);
      if (def === undefined || def.mergesInto.length === 0) continue;

      const options = def.mergesInto
        .map((id) => this.data.units.get(id))
        .filter((option): option is UnitDef => option !== undefined);
      if (options.length === 0) continue;

      opportunities.push({
        unitId,
        name: def.name,
        slots: slots.slice(0, MERGE_COST_IN_COPIES),
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
   * convergence animation ends.
   */
  applyMerge(opportunity: MergeOpportunity, chosen: UnitDef): Slot {
    const destination = opportunity.slots[0];
    if (destination === undefined) throw new Error('merge has no cells to consume');
    for (const slot of opportunity.slots) this.remove(slot.col, slot.row);
    this.place(destination.col, destination.row, chosen.id);
    return destination;
  }

  /** The board as core wants it. */
  toDeployments(): Deployment[] {
    return this.occupied().map(({ slot, unitId }) => ({
      unitId,
      col: slot.col,
      row: slot.row,
    }));
  }

  clear(): void {
    this.cells.clear();
  }
}

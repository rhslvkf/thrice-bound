/**
 * Saving and resuming the run in progress.
 *
 * `src/core/run/serialize.ts` decides what a valid run *is*; this decides where
 * it lives and when it is written. The split matters because the validation is
 * pure logic worth unit-testing and the storage is a browser API that is not.
 *
 * Writes happen at phase boundaries, never per frame. A run is small — a few
 * hundred bytes — but `localStorage` writes are synchronous and land on the
 * main thread, so doing one inside the battle loop would cost frames during
 * exactly the moment that has to stay at 60fps.
 */

import type { GameData } from '../data/schema';
import { deserializeRun, serializeRun } from '../core/run/index';
import type { RunState } from '../core/run/index';
import { createStore } from './storage';
import type { KeyValueStore } from './storage';

/** Storage key for the run in progress. Versioned separately from the payload
 *  so a future format can coexist with this one during a transition. */
export const RUN_SAVE_KEY = 'thricebound.run.v1';

export interface SaveOutcome {
  readonly persisted: boolean;
  /** Present when the write failed, for a UI that wants to warn once. */
  readonly reason?: string;
}

export class RunSaveStore {
  constructor(
    private readonly data: GameData,
    private readonly store: KeyValueStore = createStore(),
  ) {}

  /**
   * Writes the run.
   *
   * A finished run is cleared instead of stored: "continue" on the menu must
   * never resume a run that is already over.
   */
  save(state: RunState): SaveOutcome {
    if (state.phase === 'over') {
      this.clear();
      return { persisted: true };
    }
    const persisted = this.store.write(RUN_SAVE_KEY, serializeRun(state));
    return persisted
      ? { persisted }
      : { persisted, reason: 'storage is unavailable or full' };
  }

  /**
   * Reads the run, or `null` if there is nothing to resume.
   *
   * A save that fails validation is **deleted**, not kept. Leaving a bad save
   * in place means the player is offered a "continue" button that fails every
   * time they press it.
   */
  load(): RunState | null {
    const raw = this.store.read(RUN_SAVE_KEY);
    if (raw === null) return null;

    const result = deserializeRun(raw, this.data);
    if (result.ok) return result.state;

    console.warn(`discarding unreadable save: ${result.reason}`);
    this.clear();
    return null;
  }

  /** Whether a resumable run exists, without paying to validate it twice. */
  hasSave(): boolean {
    return this.store.read(RUN_SAVE_KEY) !== null;
  }

  clear(): void {
    this.store.remove(RUN_SAVE_KEY);
  }
}

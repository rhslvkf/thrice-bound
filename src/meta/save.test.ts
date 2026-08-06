import { describe, expect, it } from 'vitest';
import { loadBundledGameData } from '../data/loader';
import { buyUnit, startRun } from '../core/run/index';
import type { RunState } from '../core/run/index';
import { RUN_SAVE_KEY, RunSaveStore } from './save';
import { MemoryStore } from './storage';
import type { KeyValueStore } from './storage';

const data = loadBundledGameData();

/** Storage that refuses every write, as private browsing and quota do. */
class ReadOnlyStore implements KeyValueStore {
  private readonly entries = new Map<string, string>();
  read(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  write(): boolean {
    return false;
  }
  remove(key: string): void {
    this.entries.delete(key);
  }
}

function bought(seed: number): RunState {
  const result = buyUnit(data, startRun(data, seed), 0);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe('RunSaveStore', () => {
  it('round-trips a run through storage', () => {
    const store = new MemoryStore();
    const saves = new RunSaveStore(data, store);
    const state = bought(1234);

    expect(saves.save(state).persisted).toBe(true);
    expect(saves.load()).toEqual(state);
  });

  it('reports nothing to resume on a clean install', () => {
    const saves = new RunSaveStore(data, new MemoryStore());
    expect(saves.hasSave()).toBe(false);
    expect(saves.load()).toBeNull();
  });

  it('clears the save when the run ends, so continue never resurrects it', () => {
    const store = new MemoryStore();
    const saves = new RunSaveStore(data, store);
    saves.save(bought(7));
    expect(saves.hasSave()).toBe(true);

    saves.save({ ...bought(7), phase: 'over', result: 'defeat' });
    expect(saves.hasSave()).toBe(false);
    expect(saves.load()).toBeNull();
  });

  it('discards a corrupt save rather than offering it again', () => {
    const store = new MemoryStore();
    store.write(RUN_SAVE_KEY, '{ this is not a run }');
    const saves = new RunSaveStore(data, store);

    expect(saves.load()).toBeNull();
    // Deleted, not merely refused: a "continue" button that fails every press
    // is worse than no button.
    expect(store.read(RUN_SAVE_KEY)).toBeNull();
  });

  it('discards a save naming content this build no longer ships', () => {
    const store = new MemoryStore();
    const state = bought(9);
    store.write(
      RUN_SAVE_KEY,
      JSON.stringify({ ...state, relicIds: ['relic.from_a_future_patch'] }),
    );
    const saves = new RunSaveStore(data, store);
    expect(saves.load()).toBeNull();
  });

  it('stays playable when storage refuses writes', () => {
    const saves = new RunSaveStore(data, new ReadOnlyStore());
    const outcome = saves.save(bought(3));
    expect(outcome.persisted).toBe(false);
    expect(outcome.reason).toBeTruthy();
    // The point: it reported, it did not throw.
    expect(saves.load()).toBeNull();
  });
});

describe('MemoryStore', () => {
  it('behaves like storage that forgets on reload', () => {
    const store = new MemoryStore();
    expect(store.read('k')).toBeNull();
    expect(store.write('k', 'v')).toBe(true);
    expect(store.read('k')).toBe('v');
    store.remove('k');
    expect(store.read('k')).toBeNull();
  });
});

/**
 * The storage adapter.
 *
 * A thin interface over key/value storage, plus a `localStorage` implementation
 * and an in-memory fallback. This is the only place in the codebase that names
 * `localStorage`, which is what keeps `src/core` runnable under plain Node.
 *
 * Storage is treated as a thing that fails. It is unavailable in some embedded
 * iframes, throws on write in private browsing, and throws on quota. Every
 * method here swallows those failures and reports them as "did not work" rather
 * than propagating: a portal build that cannot persist must still be playable.
 */

export interface KeyValueStore {
  read(key: string): string | null;
  /** `false` when the write did not stick — quota, private mode, no storage. */
  write(key: string, value: string): boolean;
  remove(key: string): void;
}

/** Storage that forgets everything on reload. Used when the real one is out. */
export class MemoryStore implements KeyValueStore {
  private readonly entries = new Map<string, string>();

  read(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  write(key: string, value: string): boolean {
    this.entries.set(key, value);
    return true;
  }

  remove(key: string): void {
    this.entries.delete(key);
  }
}

class LocalStorageStore implements KeyValueStore {
  constructor(private readonly backing: Storage) {}

  read(key: string): string | null {
    try {
      return this.backing.getItem(key);
    } catch {
      return null;
    }
  }

  write(key: string, value: string): boolean {
    try {
      this.backing.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): void {
    try {
      this.backing.removeItem(key);
    } catch {
      // Nothing to do — the value is already unreachable either way.
    }
  }
}

/**
 * The best storage this environment offers.
 *
 * Probes with a real write rather than checking for the global: `localStorage`
 * exists and throws on first use in several embedded contexts, which is exactly
 * the case a feature check misses.
 */
export function createStore(): KeyValueStore {
  try {
    const backing = globalThis.localStorage as Storage | undefined;
    if (backing === undefined) return new MemoryStore();

    const probe = '__thricebound_probe__';
    backing.setItem(probe, '1');
    backing.removeItem(probe);
    return new LocalStorageStore(backing);
  } catch {
    return new MemoryStore();
  }
}

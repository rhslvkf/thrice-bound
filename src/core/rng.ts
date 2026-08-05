/**
 * Seeded deterministic RNG.
 *
 * Battle replay, balance simulation and daily-run seeds all depend on this
 * file: the same seed must always produce the same sequence, on every browser
 * and on Node. That rules out `Math.random()` anywhere in `src/core` — the
 * only randomness allowed there is an injected `Rng`.
 *
 * The generator is mulberry32: a 32-bit state PRNG with a 2^32 period, chosen
 * because it is small, fast, and reproducible with plain `Math.imul` /
 * unsigned-shift arithmetic — no BigInt, no platform-dependent float
 * behaviour.
 */

/** Number of distinct values a 32-bit unsigned integer can take. */
const UINT32_RANGE = 0x1_0000_0000;

/** Odd increment applied to the state on each step (mulberry32 constant). */
const MULBERRY32_INCREMENT = 0x6d2b79f5;

/** OR-masks that keep the mulberry32 multiplicands odd (never zero). */
const MIX_MASK_A = 1;
const MIX_MASK_B = 61;

/** Shift amounts of the mulberry32 output function. */
const SHIFT_A = 15;
const SHIFT_B = 7;
const SHIFT_C = 14;

/** FNV-1a constants, used to derive a numeric seed from a string. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * A deterministic source of randomness.
 *
 * Pass this into core logic instead of reaching for `Math.random()`. Anything
 * that consumes an `Rng` can be replayed by re-creating it from the same seed.
 */
export interface Rng {
  /** Uniform float in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `[minInclusive, maxExclusive)`. */
  nextInt(minInclusive: number, maxExclusive: number): number;
  /** Uniform float in `[minInclusive, maxExclusive)`. */
  nextFloat(minInclusive: number, maxExclusive: number): number;
  /** `true` with the given probability in `[0, 1]`. */
  nextBool(probability: number): boolean;
  /** Uniformly picks one element; throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Returns a shuffled copy, leaving the input untouched. */
  shuffle<T>(items: readonly T[]): T[];
  /** Current internal state, for snapshotting mid-battle. */
  getState(): number;
  /** Restores a state produced by {@link Rng.getState}. */
  setState(state: number): void;
  /**
   * Derives an independent stream from this one, advancing the parent by one
   * step. Used to keep sub-systems (loot rolls, crit rolls, shop rolls) from
   * shifting each other's sequences.
   */
  fork(): Rng;
}

/**
 * Hashes a string into a 32-bit unsigned integer via FNV-1a, so that
 * human-readable seeds ("daily-2026-08-05") map to stable numeric seeds.
 */
export function hashSeed(seed: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

class Mulberry32 implements Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + MULBERRY32_INCREMENT) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> SHIFT_A), t | MIX_MASK_A);
    t ^= t + Math.imul(t ^ (t >>> SHIFT_B), t | MIX_MASK_B);
    return ((t ^ (t >>> SHIFT_C)) >>> 0) / UINT32_RANGE;
  }

  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError('nextInt bounds must be integers');
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError('nextInt requires maxExclusive > minInclusive');
    }
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  nextFloat(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) {
      throw new RangeError('nextFloat requires maxExclusive > minInclusive');
    }
    return minInclusive + this.next() * (maxExclusive - minInclusive);
  }

  nextBool(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('pick requires a non-empty array');
    }
    // Safe: the index is bounded by length, which is non-zero here.
    return items[this.nextInt(0, items.length)] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = items.slice();
    // Fisher-Yates, walking downwards so each position is chosen once.
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(0, i + 1);
      const a = result[i] as T;
      const b = result[j] as T;
      result[i] = b;
      result[j] = a;
    }
    return result;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  fork(): Rng {
    return new Mulberry32(Math.floor(this.next() * UINT32_RANGE));
  }
}

/**
 * Creates a deterministic RNG. A string seed is hashed with {@link hashSeed};
 * a number is truncated to 32 unsigned bits.
 */
export function createRng(seed: number | string): Rng {
  return new Mulberry32(typeof seed === 'string' ? hashSeed(seed) : seed);
}

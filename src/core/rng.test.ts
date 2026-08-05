import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, type Rng } from './rng';

const SAMPLE_SIZE = 10_000;

const drawMany = (rng: Rng, count: number): number[] =>
  Array.from({ length: count }, () => rng.next());

describe('createRng determinism', () => {
  it('produces identical sequences for the same numeric seed', () => {
    const a = drawMany(createRng(12345), 100);
    const b = drawMany(createRng(12345), 100);
    expect(a).toEqual(b);
  });

  it('produces identical sequences for the same string seed', () => {
    const a = drawMany(createRng('daily-2026-08-05'), 100);
    const b = drawMany(createRng('daily-2026-08-05'), 100);
    expect(a).toEqual(b);
  });

  it('produces different sequences for different seeds', () => {
    const a = drawMany(createRng(1), 100);
    const b = drawMany(createRng(2), 100);
    expect(a).not.toEqual(b);
  });

  it('treats a string seed as its hashed numeric equivalent', () => {
    const seed = 'thricebound';
    expect(drawMany(createRng(seed), 20)).toEqual(
      drawMany(createRng(hashSeed(seed)), 20),
    );
  });

  it('matches a recorded golden sequence', () => {
    // Locks the algorithm itself: changing the generator invalidates every
    // stored replay and every balance baseline, so it must be a deliberate,
    // test-breaking act rather than a silent refactor.
    const first = drawMany(createRng(42), 5).map((n) => n.toFixed(12));
    expect(first).toEqual([
      '0.601103751920',
      '0.448290558998',
      '0.852465793490',
      '0.669734041439',
      '0.174813898746',
    ]);
  });
});

describe('hashSeed', () => {
  it('is stable across calls', () => {
    expect(hashSeed('run-7')).toBe(hashSeed('run-7'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const seed of ['', 'a', 'thricebound', '\u{1F600}', 'x'.repeat(500)]) {
      const hash = hashSeed(seed);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(0x1_0000_0000);
    }
  });

  it('separates similar strings', () => {
    expect(hashSeed('seed-1')).not.toBe(hashSeed('seed-2'));
  });
});

describe('next', () => {
  it('stays within [0, 1)', () => {
    const rng = createRng('range-check');
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('has a roughly uniform distribution', () => {
    const rng = createRng('uniformity');
    const bucketCount = 10;
    const buckets = new Array<number>(bucketCount).fill(0);
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const index = Math.floor(rng.next() * bucketCount);
      buckets[index] = (buckets[index] ?? 0) + 1;
    }
    const expected = SAMPLE_SIZE / bucketCount;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }
  });
});

describe('nextInt', () => {
  it('stays within the requested half-open range', () => {
    const rng = createRng('int-range');
    const seen = new Set<number>();
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const value = rng.nextInt(3, 8);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(8);
      seen.add(value);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6, 7]));
  });

  it('handles negative bounds', () => {
    const rng = createRng('negative');
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextInt(-5, -1);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(-1);
    }
  });

  it('rejects empty or inverted ranges', () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(5, 5)).toThrow(RangeError);
    expect(() => rng.nextInt(5, 1)).toThrow(RangeError);
  });

  it('rejects non-integer bounds', () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(0, 2.5)).toThrow(RangeError);
  });
});

describe('nextFloat', () => {
  it('stays within the requested range', () => {
    const rng = createRng('float-range');
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const value = rng.nextFloat(-2.5, 4.5);
      expect(value).toBeGreaterThanOrEqual(-2.5);
      expect(value).toBeLessThan(4.5);
    }
  });

  it('rejects inverted ranges', () => {
    expect(() => createRng(1).nextFloat(1, 0)).toThrow(RangeError);
  });
});

describe('nextBool', () => {
  it('always returns false at probability 0 and true at 1', () => {
    const rng = createRng('bool-edges');
    for (let i = 0; i < 1000; i += 1) {
      expect(rng.nextBool(0)).toBe(false);
      expect(rng.nextBool(1)).toBe(true);
    }
  });

  it('approximates the requested probability', () => {
    const rng = createRng('bool-rate');
    let hits = 0;
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      if (rng.nextBool(0.25)) hits += 1;
    }
    expect(hits / SAMPLE_SIZE).toBeGreaterThan(0.22);
    expect(hits / SAMPLE_SIZE).toBeLessThan(0.28);
  });
});

describe('pick', () => {
  it('only returns elements of the source array', () => {
    const rng = createRng('pick');
    const items = ['ember', 'tide', 'gale', 'stone'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.pick(items);
      expect(items).toContain(value);
      seen.add(value);
    }
    expect(seen.size).toBe(items.length);
  });

  it('is deterministic for a given seed', () => {
    const items = [1, 2, 3, 4, 5];
    const a = createRng('pick-seed');
    const b = createRng('pick-seed');
    expect(Array.from({ length: 50 }, () => a.pick(items))).toEqual(
      Array.from({ length: 50 }, () => b.pick(items)),
    );
  });

  it('throws on an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });
});

describe('shuffle', () => {
  it('does not mutate the input', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const snapshot = items.slice();
    createRng('shuffle').shuffle(items);
    expect(items).toEqual(snapshot);
  });

  it('preserves every element', () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = createRng('deck').shuffle(items);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it('is deterministic for a given seed', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(createRng('same').shuffle(items)).toEqual(
      createRng('same').shuffle(items),
    );
  });

  it('actually reorders a large array', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    expect(createRng('reorder').shuffle(items)).not.toEqual(items);
  });

  it('handles empty and single-element arrays', () => {
    const rng = createRng(1);
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['solo'])).toEqual(['solo']);
  });
});

describe('state snapshots', () => {
  it('replays from a restored state', () => {
    const rng = createRng('snapshot');
    drawMany(rng, 10);
    const state = rng.getState();
    const expected = drawMany(rng, 10);

    rng.setState(state);
    expect(drawMany(rng, 10)).toEqual(expected);
  });

  it('transplants state onto a differently seeded generator', () => {
    const source = createRng('source');
    drawMany(source, 5);

    const target = createRng('unrelated');
    target.setState(source.getState());

    expect(drawMany(target, 10)).toEqual(drawMany(source, 10));
  });
});

describe('fork', () => {
  it('creates an independent stream', () => {
    const parent = createRng('fork-parent');
    const child = parent.fork();
    // The child must not simply mirror what the parent goes on to produce.
    expect(drawMany(child, 20)).not.toEqual(drawMany(parent, 20));
  });

  it('is deterministic across identical parents', () => {
    const a = createRng('fork-seed').fork();
    const b = createRng('fork-seed').fork();
    expect(drawMany(a, 20)).toEqual(drawMany(b, 20));
  });

  it('leaves the parent unaffected by child consumption', () => {
    const parentA = createRng('isolation');
    const childA = parentA.fork();
    drawMany(childA, 100);

    const parentB = createRng('isolation');
    parentB.fork();

    expect(drawMany(parentA, 20)).toEqual(drawMany(parentB, 20));
  });
});

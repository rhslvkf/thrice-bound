import { describe, expect, it } from 'vitest';
import { Easings, TweenManager } from './tween';
import {
  MERGE_SEQUENCE_BUDGET_MS,
  TUNING_DEFAULTS,
  TUNING_FIELDS,
  mergeSequenceMs,
  readTuning,
  resetTuning,
  tuning,
  tuningToJson,
  writeTuning,
} from './tuning';

/**
 * Like `layout.ts`, these are the parts of the renderer that are pure logic:
 * curves, timing arithmetic and a budget. Getting them wrong produces
 * animation that is subtly off rather than obviously broken, which is exactly
 * the kind of bug that survives a visual check.
 */

describe('easings', () => {
  const all = Object.entries(Easings);

  it('all start at 0 and end at 1', () => {
    for (const [name, easing] of all) {
      expect(easing(0), name).toBeCloseTo(0, 6);
      expect(easing(1), name).toBeCloseTo(1, 6);
    }
  });

  it('produces finite values across the range', () => {
    for (const [name, easing] of all) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        expect(Number.isFinite(easing(t)), `${name} at ${t}`).toBe(true);
      }
    }
  });

  it('eases in: slow to start', () => {
    expect(Easings.easeInCubic(0.5)).toBeLessThan(0.5);
  });

  it('eases out: fast to start', () => {
    expect(Easings.easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('overshoots past 1 for back and elastic, and only those', () => {
    const peak = (easing: (t: number) => number): number => {
      let max = 0;
      for (let t = 0; t <= 1; t += 0.005) max = Math.max(max, easing(t));
      return max;
    };
    expect(peak(Easings.easeOutBack)).toBeGreaterThan(1);
    expect(peak(Easings.easeOutElastic)).toBeGreaterThan(1);
    // The property is that these never exceed their target, not that the
    // sampling happens to land on it.
    expect(peak(Easings.linear)).toBeLessThanOrEqual(1);
    expect(peak(Easings.easeOutCubic)).toBeLessThanOrEqual(1);
    expect(peak(Easings.easeInCubic)).toBeLessThanOrEqual(1);
  });

  it('is monotonic where it should be', () => {
    for (const easing of [Easings.linear, Easings.easeInCubic, Easings.easeOutCubic]) {
      let previous = -1;
      for (let t = 0; t <= 1; t += 0.02) {
        const value = easing(t);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });
});

describe('TweenManager', () => {
  it('runs a tween to completion and reports progress in order', () => {
    const manager = new TweenManager();
    const samples: number[] = [];
    let completed = false;

    manager.to({
      durationMs: 100,
      onUpdate: (t) => samples.push(t),
      onComplete: () => {
        completed = true;
      },
    });

    manager.update(50);
    manager.update(50);
    expect(samples[0]).toBeCloseTo(0.5, 6);
    expect(samples[samples.length - 1]).toBeCloseTo(1, 6);
    expect(completed).toBe(true);
    expect(manager.activeCount).toBe(0);
  });

  it('honours a delay before starting', () => {
    const manager = new TweenManager();
    const samples: number[] = [];
    manager.to({ durationMs: 100, delayMs: 100, onUpdate: (t) => samples.push(t) });

    manager.update(50);
    expect(samples).toHaveLength(0);
    manager.update(100);
    expect(samples[0]).toBeCloseTo(0.5, 6);
  });

  it('chains steps in order', () => {
    const manager = new TweenManager();
    const order: string[] = [];
    manager
      .to({ durationMs: 100, onComplete: () => order.push('first') })
      .then({ durationMs: 100, onComplete: () => order.push('second') })
      .call(() => order.push('third'));

    manager.update(100);
    expect(order).toEqual(['first']);
    manager.update(100);
    // The zero-duration call must not cost its own frame.
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('carries overshoot into the next step, so a chain does not drift long', () => {
    const manager = new TweenManager();
    const order: string[] = [];
    manager
      .to({ durationMs: 100, onComplete: () => order.push('a') })
      .then({ durationMs: 100, onComplete: () => order.push('b') });

    // One frame longer than the whole chain: both steps must have finished.
    manager.update(210);
    expect(order).toEqual(['a', 'b']);
  });

  it('supports a bare wait', () => {
    const manager = new TweenManager();
    let fired = false;
    manager.delay(100).call(() => {
      fired = true;
    });
    manager.update(60);
    expect(fired).toBe(false);
    manager.update(60);
    expect(fired).toBe(true);
  });

  it('cancels without running the rest of the chain', () => {
    const manager = new TweenManager();
    let ran = false;
    const tween = manager.to({ durationMs: 100 }).call(() => {
      ran = true;
    });
    tween.cancel();
    manager.update(200);
    expect(ran).toBe(false);
    expect(manager.activeCount).toBe(0);
  });

  it('recycles tweens rather than growing without bound', () => {
    const manager = new TweenManager();
    for (let i = 0; i < 200; i += 1) {
      manager.to({ durationMs: 10 });
      manager.update(20);
    }
    expect(manager.activeCount).toBe(0);
  });

  it('never reports progress outside 0..1 to the caller', () => {
    const manager = new TweenManager();
    let min = Infinity;
    let max = -Infinity;
    manager.to({
      durationMs: 100,
      easing: Easings.linear,
      onUpdate: (t) => {
        min = Math.min(min, t);
        max = Math.max(max, t);
      },
    });
    manager.update(40);
    manager.update(400);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });
});

describe('merge sequence budget', () => {
  it('fits the default timings inside the budget', () => {
    // The one hard rule on the signature moment: it fires several times a
    // round, so it must not become something the player waits through.
    expect(mergeSequenceMs(TUNING_DEFAULTS)).toBeLessThanOrEqual(MERGE_SEQUENCE_BUDGET_MS);
  });

  it('counts every stage that runs without waiting for the player', () => {
    const m = TUNING_DEFAULTS.merge;
    expect(mergeSequenceMs(TUNING_DEFAULTS)).toBe(
      m.convergeMs + m.hitstopMs + m.explosionMs + m.cardRiseMs + m.landMs,
    );
  });

  it('leaves headroom rather than sitting exactly on the limit', () => {
    // Sitting on the line means the next tweak breaks it.
    expect(mergeSequenceMs(TUNING_DEFAULTS)).toBeLessThan(MERGE_SEQUENCE_BUDGET_MS);
  });
});

describe('tuning store', () => {
  it('exposes a slider for every field it claims to tune', () => {
    for (const field of TUNING_FIELDS) {
      const group = TUNING_DEFAULTS[field.group] as unknown as Record<string, unknown>;
      expect(typeof group[field.key], `${field.group}.${field.key}`).toBe('number');
    }
  });

  it('covers every tunable value with a slider', () => {
    const covered = new Set(TUNING_FIELDS.map((field) => `${field.group}.${field.key}`));
    for (const [group, values] of Object.entries(TUNING_DEFAULTS)) {
      for (const key of Object.keys(values as Record<string, number>)) {
        expect(covered.has(`${group}.${key}`), `${group}.${key} has no slider`).toBe(true);
      }
    }
  });

  it('gives every field a range that contains its default', () => {
    for (const field of TUNING_FIELDS) {
      const group = TUNING_DEFAULTS[field.group] as unknown as Record<string, number>;
      const value = group[field.key] ?? 0;
      expect(value, `${field.group}.${field.key}`).toBeGreaterThanOrEqual(field.min);
      expect(value, `${field.group}.${field.key}`).toBeLessThanOrEqual(field.max);
    }
  });

  it('reads and writes live values', () => {
    const field = TUNING_FIELDS[0];
    expect(field).toBeDefined();
    if (field === undefined) return;

    const original = readTuning(field);
    writeTuning(field, original + field.step);
    expect(readTuning(field)).toBe(original + field.step);
    resetTuning();
    expect(readTuning(field)).toBe(original);
  });

  it('resets every group, not just the one that changed', () => {
    tuning.merge.convergeMs = 999;
    tuning.hit.flashMs = 999;
    resetTuning();
    expect(tuning.merge.convergeMs).toBe(TUNING_DEFAULTS.merge.convergeMs);
    expect(tuning.hit.flashMs).toBe(TUNING_DEFAULTS.hit.flashMs);
  });

  it('exports values that parse back into the same shape', () => {
    resetTuning();
    expect(JSON.parse(tuningToJson())).toEqual(TUNING_DEFAULTS);
  });

  it('does not let a mutation leak into the defaults', () => {
    tuning.merge.convergeMs = 12;
    expect(TUNING_DEFAULTS.merge.convergeMs).not.toBe(12);
    resetTuning();
  });
});

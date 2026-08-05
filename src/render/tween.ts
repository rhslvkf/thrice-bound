/**
 * Tweening.
 *
 * Written rather than imported: the project ships no animation library, and
 * what a game like this actually needs from one is small — interpolate a
 * number over a duration, wait, then do the next thing. The whole system is
 * one manager, a pooled step, and five easing curves.
 *
 * Tweens are pooled. A battle produces a tween per hit, per death, per merge
 * step; allocating a closure-laden object for each would put garbage on the
 * critical path of exactly the moments that are supposed to feel sharp.
 *
 * Time here is *scaled* time, not real time. The caller feeds in whatever
 * delta the hitstop system says has passed, so a freeze holds tweens still
 * along with everything else.
 */

export type Easing = (t: number) => number;

/** Overshoot constant for `easeOutBack`, the standard 1.70158. */
const BACK_OVERSHOOT = 1.70158;
/** Period and decay of `easeOutElastic`. */
const ELASTIC_PERIOD = 0.3;
const ELASTIC_DECAY = 10;

export const Easings = {
  linear: (t: number): number => t,

  easeInCubic: (t: number): number => t * t * t,

  easeOutCubic: (t: number): number => 1 - (1 - t) ** 3,

  /** Overshoots the target and settles back. Good for something arriving. */
  easeOutBack: (t: number): number => {
    const c = BACK_OVERSHOOT + 1;
    return 1 + c * (t - 1) ** 3 + BACK_OVERSHOOT * (t - 1) ** 2;
  },

  /** Overshoots and oscillates down. Good for something snapping home. */
  easeOutElastic: (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return (
      2 ** (-ELASTIC_DECAY * t) *
        Math.sin(((t - ELASTIC_PERIOD / 4) * (Math.PI * 2)) / ELASTIC_PERIOD) +
      1
    );
  },
} as const satisfies Record<string, Easing>;

export type EasingName = keyof typeof Easings;

export interface TweenStep {
  readonly durationMs: number;
  readonly delayMs?: number;
  readonly easing?: Easing;
  /** Called every frame with eased progress in `[0, 1]`. */
  readonly onUpdate?: (t: number) => void;
  readonly onComplete?: () => void;
}

/**
 * A running tween, and the handle used to chain onto it.
 *
 * `then` queues a step to start when this one finishes, which is how a
 * multi-stage sequence like the merge is expressed without nesting callbacks.
 */
export class Tween {
  private steps: TweenStep[] = [];
  private index = 0;
  private elapsedMs = 0;
  private done = true;
  private cancelled = false;

  /** @internal — reset by the manager when taken from the pool. */
  reset(step: TweenStep): void {
    this.steps.length = 0;
    this.steps.push(step);
    this.index = 0;
    this.elapsedMs = 0;
    this.done = false;
    this.cancelled = false;
  }

  /** Queues a step to run after the current chain finishes. */
  then(step: TweenStep): this {
    this.steps.push(step);
    this.done = false;
    return this;
  }

  /** Queues a pause. Sugar for a step that does nothing for a while. */
  wait(durationMs: number): this {
    return this.then({ durationMs });
  }

  /** Queues a one-shot callback. */
  call(action: () => void): this {
    return this.then({ durationMs: 0, onComplete: action });
  }

  cancel(): void {
    this.cancelled = true;
    this.done = true;
  }

  get finished(): boolean {
    return this.done;
  }

  /** @internal — advances the chain. Returns `true` when it can be recycled. */
  advance(deltaMs: number): boolean {
    if (this.cancelled) return true;

    let remaining = deltaMs;
    // A loop rather than one step per frame: zero-duration steps (a bare
    // callback) must not each cost a frame, or a chain of them would crawl.
    while (remaining >= 0 && this.index < this.steps.length) {
      const step = this.steps[this.index];
      if (step === undefined) break;

      const delay = step.delayMs ?? 0;
      const total = delay + step.durationMs;
      this.elapsedMs += remaining;
      remaining = 0;

      if (this.elapsedMs < delay) return false;

      const progress =
        step.durationMs <= 0 ? 1 : Math.min(1, (this.elapsedMs - delay) / step.durationMs);
      const easing = step.easing ?? Easings.linear;
      step.onUpdate?.(easing(progress));

      if (progress < 1) return false;

      step.onComplete?.();
      // Carry the overshoot into the next step so a chain does not drift
      // longer than the sum of its parts.
      remaining = this.elapsedMs - total;
      this.elapsedMs = 0;
      this.index += 1;
    }

    this.done = this.index >= this.steps.length;
    return this.done;
  }
}

/**
 * Runs tweens.
 *
 * One per scene. `update` is fed scaled time, so everything it drives freezes
 * together during a hitstop.
 */
export class TweenManager {
  private readonly active: Tween[] = [];
  private readonly pool: Tween[] = [];

  /** Starts a tween and returns it, so further steps can be chained on. */
  to(step: TweenStep): Tween {
    const tween = this.pool.pop() ?? new Tween();
    tween.reset(step);
    this.active.push(tween);
    return tween;
  }

  /** Starts a chain from a bare delay. */
  delay(durationMs: number): Tween {
    return this.to({ durationMs });
  }

  update(deltaMs: number): void {
    // Backwards, so removing a finished tween cannot skip the next one.
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const tween = this.active[i];
      if (tween === undefined) continue;
      if (tween.advance(deltaMs)) {
        this.active.splice(i, 1);
        this.pool.push(tween);
      }
    }
  }

  get activeCount(): number {
    return this.active.length;
  }

  cancelAll(): void {
    for (const tween of this.active) {
      tween.cancel();
      this.pool.push(tween);
    }
    this.active.length = 0;
  }
}

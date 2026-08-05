/**
 * Camera.
 *
 * Fixed framing — no panning, no zoom. The whole board is always on screen,
 * which is the point of a five-by-four board: the player should never have to
 * hunt for what is happening.
 *
 * The one thing it does is shake, as feedback for a kill. Shake is a decaying
 * oscillation applied as a container offset, seeded from the core RNG so a
 * replay of the same battle shakes identically. That is not required for
 * correctness — the renderer cannot affect the battle either way — but a
 * replay that differs frame to frame is harder to compare against itself when
 * something looks wrong.
 */

import type { Container } from 'pixi.js';
import { createRng } from '../core/rng';
import type { Rng } from '../core/rng';
import { ANIM } from './config';

export class Camera {
  private readonly rng: Rng;
  private magnitude = 0;
  private phaseX = 0;
  private phaseY = 0;
  private elapsedMs = 0;

  constructor(
    private readonly target: Container,
    seed = 1,
  ) {
    this.rng = createRng(seed);
  }

  /** Adds shake, in cell fractions. Repeated hits stack up to the cap. */
  shake(amount: number): void {
    if (amount <= 0) return;
    this.magnitude = Math.min(ANIM.shakeMax, this.magnitude + amount);
    // New phases each time, so consecutive kills do not resonate into a
    // single smooth wobble.
    this.phaseX = this.rng.nextFloat(0, Math.PI * 2);
    this.phaseY = this.rng.nextFloat(0, Math.PI * 2);
  }

  /** `cellSize` converts the cell-relative magnitude into pixels. */
  update(deltaMs: number, cellSize: number): void {
    if (this.magnitude <= 0) {
      if (this.target.position.x !== 0 || this.target.position.y !== 0) {
        this.target.position.set(0, 0);
      }
      return;
    }

    this.elapsedMs += deltaMs;
    this.magnitude = Math.max(0, this.magnitude - (ANIM.shakeDecay * deltaMs) / 1000);

    const seconds = this.elapsedMs / 1000;
    const angle = seconds * ANIM.shakeFrequency;
    const amplitude = this.magnitude * cellSize;
    this.target.position.set(
      Math.sin(angle + this.phaseX) * amplitude,
      Math.cos(angle * 0.9 + this.phaseY) * amplitude * 0.6,
    );
  }

  reset(): void {
    this.magnitude = 0;
    this.target.position.set(0, 0);
  }
}

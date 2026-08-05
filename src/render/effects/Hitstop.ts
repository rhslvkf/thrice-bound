/**
 * Hitstop.
 *
 * Freezing for a few frames on impact is the cheapest weight a hit can be
 * given: the eye reads the pause as the blow landing hard. It works by scaling
 * the delta everything else is driven by, so the replay, the tweens and the
 * particles all stop together — a freeze where the particles keep sailing on
 * looks like a dropped frame, not a punch.
 *
 * The freeze itself is counted in **real** time. If it were counted in scaled
 * time a full stop would never end.
 *
 * None of this can affect a battle. The simulation already ran; this only
 * changes the rate at which its log is read back.
 */

export class Hitstop {
  private remainingMs = 0;
  private scale = 0;

  /**
   * Requests a freeze.
   *
   * Overlapping requests take the longer remaining time rather than adding —
   * a flurry of hits should feel punchy, not like the game hanging.
   */
  freeze(durationMs: number, scale = 0): void {
    if (durationMs <= 0) return;
    this.remainingMs = Math.max(this.remainingMs, durationMs);
    this.scale = scale;
  }

  get frozen(): boolean {
    return this.remainingMs > 0;
  }

  /** Consumes a real frame delta and returns the delta the game should use. */
  apply(realDeltaMs: number): number {
    if (this.remainingMs <= 0) return realDeltaMs;

    const frozenPortion = Math.min(this.remainingMs, realDeltaMs);
    this.remainingMs -= frozenPortion;
    const remainder = realDeltaMs - frozenPortion;
    // The frozen slice runs at the reduced rate; anything past the end of the
    // freeze runs at full rate, so a long frame does not swallow time.
    return frozenPortion * this.scale + remainder;
  }

  clear(): void {
    this.remainingMs = 0;
  }
}

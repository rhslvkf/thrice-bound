/**
 * Deterministic randomness for a run.
 *
 * A run does **not** carry an RNG state. It carries a seed, and every roll
 * derives its own stream from that seed plus a label naming what is being
 * rolled: `shop:5:2` is the third shop of round 5, `reward:5` is that round's
 * relic offer.
 *
 * The alternative — one long stream advanced by every roll — was rejected on
 * purpose. With a single stream, rerolling twice in round 2 shifts every roll
 * for the rest of the run, so "the same seed" only means "the same seed if you
 * also play identically". Labelled streams make round 9's shop a function of
 * the seed alone, which is what a shared seed has to mean before a daily
 * challenge can be built on it.
 *
 * It also makes save/resume free: there is no stream position to preserve, so a
 * run reloaded from storage rolls exactly what it would have rolled.
 */

import type { Rng } from '../rng';
import { createRng, hashSeed } from '../rng';

/** What is being rolled. The label is part of the seed, so these are stable. */
export type StreamLabel =
  | { readonly kind: 'shop'; readonly round: number; readonly roll: number }
  | { readonly kind: 'reward'; readonly round: number }
  | { readonly kind: 'battle'; readonly round: number };

function labelOf(label: StreamLabel): string {
  switch (label.kind) {
    case 'shop':
      return `shop:${label.round}:${label.roll}`;
    case 'reward':
      return `reward:${label.round}`;
    case 'battle':
      return `battle:${label.round}`;
  }
}

/**
 * Derives the seed for one labelled stream.
 *
 * Exposed separately from {@link streamRng} because a battle needs a *number*
 * to hand to `BattleSetup`, not a generator.
 */
export function streamSeed(runSeed: number, label: StreamLabel): number {
  return hashSeed(`${runSeed >>> 0}/${labelOf(label)}`);
}

/** A generator for one labelled stream. Independent of every other stream. */
export function streamRng(runSeed: number, label: StreamLabel): Rng {
  return createRng(streamSeed(runSeed, label));
}

/**
 * How long a run takes a person.
 *
 * Two halves, and it matters which is which:
 *
 * - **Measured.** Battle length comes from the simulation — ticks times the
 *   tick size is exactly how many seconds of playback the renderer produces at
 *   1x. Decision *counts* are also measured: the scripted player really does
 *   make that many purchases and merges.
 * - **Estimated.** How long each of those decisions takes a human. Those live
 *   in `PACING` in `config.ts`, one named constant each, so the model can be
 *   argued with rather than trusted.
 *
 * The split is the point. If the answer comes out wrong, the fix is either a
 * content change (fights too long) or a re-estimate (people are faster than
 * assumed) — and the report says which.
 */

import { BATTLE } from '../core/config';
import { PACING } from './config';
import type { RunActivity } from './runplayer';

export interface RunDuration {
  /** Battle playback at 1x, in seconds. Measured, not estimated. */
  readonly battleSeconds: number;
  /** Everything the player does between fights. Estimated. */
  readonly decisionSeconds: number;
  readonly totalSeconds: number;
}

/** Seconds of playback for a battle of `ticks` ticks, at 1x speed. */
export function playbackSeconds(ticks: number): number {
  return (ticks * BATTLE.tickMs) / BATTLE.msPerSecond;
}

export function estimateDuration(activity: RunActivity): RunDuration {
  const battleSeconds = playbackSeconds(activity.battleTicks);

  const decisionSeconds =
    activity.shopsVisited * (PACING.shopReadSeconds + PACING.arrangeSeconds) +
    activity.purchases * PACING.purchaseSeconds +
    activity.rerolls * PACING.rerollSeconds +
    activity.sells * PACING.sellSeconds +
    activity.merges * PACING.mergeSeconds +
    activity.rewardChoices * PACING.rewardSeconds +
    activity.battles * (PACING.battleStartSeconds + PACING.postBattleSeconds);

  return {
    battleSeconds,
    decisionSeconds,
    totalSeconds: battleSeconds + decisionSeconds,
  };
}

/** `m:ss`, for a report a human reads. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

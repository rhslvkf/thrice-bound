/**
 * Run-level simulation.
 *
 * Plays whole runs with the scripted player in `runplayer.ts` and aggregates
 * what happened: how long they take, how far they get, how often they end in a
 * win. This is the tool that answers "is a run 6 to 10 minutes" with a number.
 *
 * Single-threaded on purpose. A run is a few thousand ticks and a few hundred
 * decisions — a thousand of them finish in seconds, so the worker pool the
 * matchup simulator needs would be pure overhead here.
 */

import type { GameData } from '../data/schema';
import type { RoundRecord } from '../core/run/index';
import { estimateDuration, playbackSeconds } from './pacing';
import type { RunDuration } from './pacing';
import { playRun } from './runplayer';
import type { RunActivity } from './runplayer';

export interface RunSample {
  readonly seed: number;
  readonly result: 'victory' | 'defeat';
  /** Rounds actually fought. A victory reaches `rules.rounds`. */
  readonly roundsReached: number;
  readonly livesLeft: number;
  readonly relicsHeld: number;
  readonly wins: number;
  readonly losses: number;
  readonly history: readonly RoundRecord[];
  readonly activity: RunActivity;
  readonly duration: RunDuration;
}

export interface RoundStats {
  readonly round: number;
  /** Runs that reached this round. Falls as runs die out. */
  readonly played: number;
  readonly wins: number;
  readonly winRate: number;
  readonly meanTicks: number;
  readonly meanSeconds: number;
  readonly meanLivesLost: number;
}

export interface DurationStats {
  readonly meanSeconds: number;
  readonly medianSeconds: number;
  readonly p10Seconds: number;
  readonly p90Seconds: number;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly meanBattleSeconds: number;
  readonly meanDecisionSeconds: number;
  /** Share of runs inside the target band. */
  readonly inTargetBand: number;
}

export interface RunAggregate {
  readonly samples: readonly RunSample[];
  readonly victories: number;
  readonly defeats: number;
  readonly victoryRate: number;
  readonly meanRoundsReached: number;
  readonly duration: DurationStats;
  readonly victoryDuration: DurationStats;
  readonly perRound: readonly RoundStats[];
  readonly meanActivity: RunActivity;
}

/** The band the design is aiming for, in seconds. */
export const TARGET_BAND_SECONDS = { min: 6 * 60, max: 10 * 60 } as const;

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function durationStats(samples: readonly RunSample[]): DurationStats {
  const totals = samples.map((sample) => sample.duration.totalSeconds).sort((a, b) => a - b);
  const inBand = totals.filter(
    (seconds) => seconds >= TARGET_BAND_SECONDS.min && seconds <= TARGET_BAND_SECONDS.max,
  ).length;

  return {
    meanSeconds: mean(totals),
    medianSeconds: percentile(totals, 0.5),
    p10Seconds: percentile(totals, 0.1),
    p90Seconds: percentile(totals, 0.9),
    minSeconds: totals[0] ?? 0,
    maxSeconds: totals[totals.length - 1] ?? 0,
    meanBattleSeconds: mean(samples.map((sample) => sample.duration.battleSeconds)),
    meanDecisionSeconds: mean(samples.map((sample) => sample.duration.decisionSeconds)),
    inTargetBand: totals.length === 0 ? 0 : inBand / totals.length,
  };
}

/** Plays one run and reduces it to a sample. */
export function sampleRun(data: GameData, seed: number): RunSample {
  const { state, activity } = playRun(data, seed);
  const wins = state.history.filter((round) => round.outcome === 'player').length;

  return {
    seed,
    result: state.result ?? 'defeat',
    roundsReached: state.history.length,
    livesLeft: state.lives,
    relicsHeld: state.relicIds.length,
    wins,
    losses: state.history.length - wins,
    history: state.history,
    activity,
    duration: estimateDuration(activity),
  };
}

/**
 * Per-round statistics.
 *
 * Computed from each run's history so a round only counts for runs that
 * actually reached it — otherwise round 12 would show a flattering win rate
 * purely because only strong runs get there.
 */
function roundStatsFor(samples: readonly RunSample[], round: number): RoundStats {
  let played = 0;
  let wins = 0;
  let ticks = 0;
  let livesLost = 0;

  for (const sample of samples) {
    const record = sample.history.find((entry) => entry.round === round);
    if (record === undefined) continue;
    played += 1;
    ticks += record.ticks;
    livesLost += record.livesLost;
    if (record.outcome === 'player') wins += 1;
  }

  const meanTicks = played === 0 ? 0 : ticks / played;
  return {
    round,
    played,
    wins,
    winRate: played === 0 ? 0 : wins / played,
    meanTicks,
    meanSeconds: playbackSeconds(meanTicks),
    meanLivesLost: played === 0 ? 0 : livesLost / played,
  };
}

export function simulateRuns(data: GameData, seed: number, count: number): RunAggregate {
  const samples: RunSample[] = [];
  for (let i = 0; i < count; i += 1) {
    // Seeds spaced by the golden-ratio stride rather than 0..n, so consecutive
    // runs do not share the low bits mulberry32 mixes last.
    samples.push(sampleRun(data, (seed + i * 0x9e37_79b9) >>> 0));
  }

  const victories = samples.filter((sample) => sample.result === 'victory');
  const perRound: RoundStats[] = [];
  for (let round = 1; round <= data.run.rules.rounds; round += 1) {
    perRound.push(roundStatsFor(samples, round));
  }

  return {
    samples,
    victories: victories.length,
    defeats: samples.length - victories.length,
    victoryRate: samples.length === 0 ? 0 : victories.length / samples.length,
    meanRoundsReached: mean(samples.map((sample) => sample.roundsReached)),
    duration: durationStats(samples),
    victoryDuration: durationStats(victories),
    perRound,
    meanActivity: {
      shopsVisited: mean(samples.map((s) => s.activity.shopsVisited)),
      purchases: mean(samples.map((s) => s.activity.purchases)),
      rerolls: mean(samples.map((s) => s.activity.rerolls)),
      sells: mean(samples.map((s) => s.activity.sells)),
      merges: mean(samples.map((s) => s.activity.merges)),
      rewardChoices: mean(samples.map((s) => s.activity.rewardChoices)),
      battles: mean(samples.map((s) => s.activity.battles)),
      battleTicks: mean(samples.map((s) => s.activity.battleTicks)),
    },
  };
}

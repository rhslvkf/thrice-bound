/**
 * The unit of work handed to a worker, and how to execute it.
 *
 * Running a job is a pure function of the job itself: a job carries the seed
 * and the index range it covers, never a pre-built team. That is what lets the
 * main thread hand the same job to any worker, and why the aggregate does not
 * depend on how the work was split.
 */

import { runBattle } from '../core/battle/index';
import type { GameData } from '../data/schema';
import { mergePairs, mergePathSetups, randomSetup } from './matchup';
import { emptyAggregate, recordBattle, recordMergeSample } from './metrics';
import type { Aggregate } from './metrics';

/** A slice of the random sweep. */
export interface RandomJob {
  readonly kind: 'random';
  readonly firstIndex: number;
  readonly count: number;
  readonly seed: number;
  readonly teamSize: number;
}

/** A slice of the paired merge-path study, for one merge decision. */
export interface MergeJob {
  readonly kind: 'merge';
  /** Index into `mergePairs(data)`. */
  readonly pairIndex: number;
  readonly firstSample: number;
  readonly count: number;
  readonly seed: number;
  readonly teamSize: number;
}

export type Job = RandomJob | MergeJob;

/** Splits the run into work items small enough to balance across workers. */
export function planJobs(
  data: GameData,
  options: {
    readonly matches: number;
    readonly seed: number;
    readonly teamSize: number;
    readonly mergeSamples: number;
    readonly chunkSize: number;
  },
): Job[] {
  const jobs: Job[] = [];

  for (let first = 0; first < options.matches; first += options.chunkSize) {
    jobs.push({
      kind: 'random',
      firstIndex: first,
      count: Math.min(options.chunkSize, options.matches - first),
      seed: options.seed,
      teamSize: options.teamSize,
    });
  }

  if (options.mergeSamples > 0) {
    const pairs = mergePairs(data);
    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      for (let first = 0; first < options.mergeSamples; first += options.chunkSize) {
        jobs.push({
          kind: 'merge',
          pairIndex,
          firstSample: first,
          count: Math.min(options.chunkSize, options.mergeSamples - first),
          seed: options.seed,
          teamSize: options.teamSize,
        });
      }
    }
  }

  return jobs;
}

/** How many battles a job will run, for progress reporting. */
export function battlesIn(data: GameData, job: Job): number {
  if (job.kind === 'random') return job.count;
  const pair = mergePairs(data)[job.pairIndex];
  return job.count * (pair?.options.length ?? 0);
}

/** Runs a job and returns its aggregate. */
export function runJob(data: GameData, job: Job): Aggregate {
  const aggregate = emptyAggregate();

  if (job.kind === 'random') {
    for (let i = 0; i < job.count; i += 1) {
      const setup = randomSetup(data, job.seed, job.firstIndex + i, job.teamSize);
      recordBattle(aggregate, data, runBattle(data, setup));
    }
    return aggregate;
  }

  const pair = mergePairs(data)[job.pairIndex];
  if (pair === undefined) return aggregate;

  for (let i = 0; i < job.count; i += 1) {
    const sample = job.firstSample + i;
    const setups = mergePathSetups(data, pair, sample, job.seed, job.teamSize);
    setups.forEach((setup, optionIndex) => {
      const optionId = pair.options[optionIndex];
      if (optionId === undefined) return;
      // Each arm faces the same enemy, the same supporting cast and the same
      // battle seed, so the only difference measured is the merge choice.
      recordMergeSample(aggregate, pair.parentId, optionId, runBattle(data, setup));
    });
  }
  return aggregate;
}

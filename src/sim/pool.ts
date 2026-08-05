/**
 * Worker pool.
 *
 * Battles are pure CPU with no I/O to overlap, so the pool is deliberately
 * plain: one worker per core, jobs handed out on demand. Pulling work rather
 * than pre-splitting it evenly matters because battle lengths vary by an order
 * of magnitude — a static split leaves cores idle waiting for one unlucky
 * chunk.
 *
 * The result is independent of how the work was divided: every job derives its
 * own seeds, and the aggregate's accumulators are integers, so a 1-worker run
 * and an 8-worker run produce identical numbers. (Float accumulators would
 * not: float addition is not associative, and workers finish out of order.)
 */

import { Worker } from 'node:worker_threads';
import type { GameData } from '../data/schema';
import { battlesIn, runJob } from './jobs';
import type { Job } from './jobs';
import { emptyAggregate, mergeAggregates } from './metrics';
import type { Aggregate } from './metrics';

export interface PoolOptions {
  readonly workers: number;
  /** Called as jobs land, with battles finished so far. */
  readonly onProgress?: (battlesDone: number, battlesTotal: number) => void;
}

/**
 * Source for a worker thread.
 *
 * Node cannot load TypeScript directly and `execArgv` does not accept the
 * loader flag, so the worker starts from a tiny eval'd bootstrap that
 * registers `tsx` and then imports the real module. The registration is
 * optional: if this ever runs from compiled JavaScript, `tsx` will be absent
 * and the import still resolves.
 */
function workerBootstrap(): string {
  const target = new URL('./worker.ts', import.meta.url).href;
  return `
    import('tsx/esm/api')
      .then((tsx) => { tsx.register(); })
      .catch(() => {})
      .then(() => import(${JSON.stringify(target)}));
  `;
}

/** Runs every job on the current thread. Used when only one worker is asked for. */
function runInline(
  data: GameData,
  jobs: readonly Job[],
  options: PoolOptions,
): Aggregate {
  const total = jobs.reduce((sum, job) => sum + battlesIn(data, job), 0);
  const aggregate = emptyAggregate();
  let done = 0;
  for (const job of jobs) {
    mergeAggregates(aggregate, runJob(data, job));
    done += battlesIn(data, job);
    options.onProgress?.(done, total);
  }
  return aggregate;
}

/**
 * Runs every job, in parallel when asked for, and folds the results together.
 *
 * @throws {Error} if a worker fails; the remaining workers are terminated
 *   rather than left running.
 */
export async function runJobsInPool(
  data: GameData,
  jobs: readonly Job[],
  options: PoolOptions,
): Promise<Aggregate> {
  const workerCount = Math.min(options.workers, jobs.length);
  if (workerCount <= 1) return runInline(data, jobs, options);

  const totalBattles = jobs.reduce((sum, job) => sum + battlesIn(data, job), 0);
  const aggregate = emptyAggregate();
  let nextJob = 0;
  let battlesDone = 0;
  let outstanding = jobs.length;

  const workers: Worker[] = [];
  const bootstrap = workerBootstrap();

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const dispatch = (worker: Worker): void => {
        if (nextJob >= jobs.length) {
          worker.postMessage({ close: true });
          return;
        }
        const id = nextJob;
        nextJob += 1;
        worker.postMessage({ id, job: jobs[id] });
      };

      for (let i = 0; i < workerCount; i += 1) {
        const worker = new Worker(bootstrap, { eval: true });
        workers.push(worker);

        worker.on('message', (message: { kind: string; id?: number; aggregate?: Aggregate }) => {
          if (message.kind === 'ready') {
            dispatch(worker);
            return;
          }
          if (message.kind !== 'result' || message.aggregate === undefined) return;

          mergeAggregates(aggregate, message.aggregate);
          const job = jobs[message.id ?? -1];
          if (job !== undefined) battlesDone += battlesIn(data, job);
          options.onProgress?.(battlesDone, totalBattles);

          outstanding -= 1;
          if (outstanding === 0) {
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }
          dispatch(worker);
        });

        worker.on('error', fail);
        worker.on('exit', (code) => {
          // A clean exit after `close` is expected; anything else while work
          // remains means a worker died mid-run.
          if (code !== 0 && outstanding > 0) {
            fail(new Error(`sim worker exited with code ${code}`));
          }
        });
      }
    });
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  return aggregate;
}

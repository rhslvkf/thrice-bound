/**
 * Worker-thread entry point.
 *
 * Loads and validates the content once, then answers job requests until the
 * pool closes it. Only aggregates cross the thread boundary — never event
 * logs, which would dominate the message cost for no benefit.
 */

import { parentPort } from 'node:worker_threads';
import { loadBundledGameData } from '../data/loader';
import { runJob } from './jobs';
import type { Job } from './jobs';

export interface JobRequest {
  readonly id: number;
  readonly job: Job;
}

export type WorkerMessage =
  | { readonly kind: 'ready' }
  | { readonly kind: 'result'; readonly id: number; readonly aggregate: unknown };

const port = parentPort;
if (port === null) {
  throw new Error('sim/worker.ts must be started as a worker thread');
}

const data = loadBundledGameData();

port.on('message', (message: JobRequest | { readonly close: true }) => {
  if ('close' in message) {
    port.close();
    return;
  }
  port.postMessage({
    kind: 'result',
    id: message.id,
    aggregate: runJob(data, message.job),
  });
});

port.postMessage({ kind: 'ready' });

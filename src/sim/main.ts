/**
 * Headless balance simulator entry point — stub.
 *
 * Run with `npm run sim`. Once battle resolution lands in `src/core`, this
 * will run N battles per seed and print win rates, average turn counts and
 * synergy pick rates. It must stay runnable under plain Node: importing
 * anything from `src/render`, `src/ui` or `src/audio` here is a bug.
 */
import { createRng } from '../core/rng';

const DEFAULT_SEED = 'thricebound';

function main(argv: readonly string[]): void {
  const seed = argv[0] ?? DEFAULT_SEED;
  const rng = createRng(seed);

  console.log(`THRICEBOUND balance simulator (stub)`);
  console.log(`seed: ${seed}`);
  console.log(`first roll: ${rng.next()}`);
  console.log(`no battle model yet - nothing to simulate.`);
}

main(process.argv.slice(2));

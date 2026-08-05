/**
 * Command-line parsing for the simulator.
 *
 * Kept separate from `main.ts` so the option rules are unit-testable without
 * spawning workers or writing files.
 */

import { availableParallelism } from 'node:os';
import { SIM_DEFAULTS } from './config';

export interface SimOptions {
  readonly matches: number;
  readonly seed: number;
  readonly workers: number;
  readonly teamSize: number;
  /** Paired battles per merge option. `0` skips the merge study entirely. */
  readonly mergeSamples: number;
  readonly outDir: string;
  /** Snapshot to compare against, or `null` to use the one in `outDir`. */
  readonly baseline: string | null;
  readonly writeReport: boolean;
  readonly quiet: boolean;
  readonly help: boolean;
}

export const USAGE = `THRICEBOUND balance simulator

  npm run sim -- [options]

Options:
  --matches N        random matches to run            (default ${SIM_DEFAULTS.matches})
  --seed N           base seed for the whole run      (default ${SIM_DEFAULTS.seed})
  --workers N        worker threads                   (default: CPU count)
  --team-size N      units deployed per side          (default ${SIM_DEFAULTS.teamSize})
  --merge-samples N  paired battles per merge option  (default ${SIM_DEFAULTS.mergeSamples}, 0 to skip)
  --out DIR          report directory                 (default ${SIM_DEFAULTS.outDir})
  --baseline PATH    snapshot to compare against      (default <out>/latest.json)
  --no-report        run the analysis but write nothing
  --quiet            suppress progress output
  --help             show this message

Examples:
  npm run sim -- --matches 10000 --seed 42
  npm run sim -- --matches 500 --merge-samples 0 --no-report`;

class CliError extends Error {}

function parseCount(raw: string | undefined, flag: string, min: number): number {
  if (raw === undefined) throw new CliError(`${flag} needs a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new CliError(`${flag} expects an integer >= ${min}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Parses argv into options.
 *
 * @throws {Error} with a readable message for an unknown flag or bad value.
 */
export function parseArgs(argv: readonly string[]): SimOptions {
  let matches: number = SIM_DEFAULTS.matches;
  let seed: number = SIM_DEFAULTS.seed;
  let workers = 0;
  let teamSize: number = SIM_DEFAULTS.teamSize;
  let mergeSamples: number = SIM_DEFAULTS.mergeSamples;
  let outDir: string = SIM_DEFAULTS.outDir;
  let baseline: string | null = null;
  let writeReport = true;
  let quiet = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--matches':
        matches = parseCount(argv[(i += 1)], flag, 1);
        break;
      case '--seed':
        seed = parseCount(argv[(i += 1)], flag, 0);
        break;
      case '--workers':
        workers = parseCount(argv[(i += 1)], flag, 1);
        break;
      case '--team-size':
        teamSize = parseCount(argv[(i += 1)], flag, 1);
        break;
      case '--merge-samples':
        mergeSamples = parseCount(argv[(i += 1)], flag, 0);
        break;
      case '--out': {
        const value = argv[(i += 1)];
        if (value === undefined) throw new CliError(`${flag} needs a value`);
        outDir = value;
        break;
      }
      case '--baseline': {
        const value = argv[(i += 1)];
        if (value === undefined) throw new CliError(`${flag} needs a value`);
        baseline = value;
        break;
      }
      case '--no-report':
        writeReport = false;
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new CliError(
          `unknown option ${JSON.stringify(flag)}\n\n${USAGE}`,
        );
    }
  }

  return {
    matches,
    seed,
    // One worker per core. More would only add context switching: the work is
    // pure CPU with no I/O to overlap.
    workers: workers > 0 ? workers : Math.max(1, availableParallelism()),
    teamSize,
    mergeSamples,
    outDir,
    baseline,
    writeReport,
    quiet,
    help,
  };
}

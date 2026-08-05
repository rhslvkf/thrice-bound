/**
 * Balance simulator entry point.
 *
 *   npm run sim -- --matches 10000 --seed 42
 *
 * Runs the same battle code the browser runs, in parallel across worker
 * threads, and writes a markdown report plus CSVs to `tools/reports/`.
 *
 * Only this file touches the filesystem or the console; the analysis in
 * `metrics.ts` and `report.ts` is pure and tested directly.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadBundledGameData } from '../data/loader';
import { parseArgs, USAGE } from './cli';
import type { SimOptions } from './cli';
import { SIM_DEFAULTS } from './config';
import { battlesIn, planJobs } from './jobs';
import { runJobsInPool } from './pool';
import {
  buildSnapshot,
  collectWarnings,
  durationsCsv,
  findRegressions,
  mergePathsCsv,
  missingMergeStudies,
  renderMarkdown,
  synergiesCsv,
  unitsCsv,
} from './report';
import type { Snapshot } from './report';

const SNAPSHOT_FILE = 'latest.json';
const REPORT_FILE = 'balance-report.md';

/** Loads the previous snapshot, treating anything unreadable as "no baseline". */
async function readBaseline(path: string): Promise<Snapshot | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      (parsed as { version: unknown }).version === 1
    ) {
      return parsed as Snapshot;
    }
    console.warn(`  baseline at ${path} has an unknown format; skipping comparison`);
    return null;
  } catch {
    // Absent on the first run, which is not an error.
    return null;
  }
}

function progressBar(done: number, total: number): string {
  const width = 28;
  const filled = total === 0 ? width : Math.round((done / total) * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(Math.max(0, width - filled))}]`;
}

async function run(options: SimOptions): Promise<number> {
  const data = loadBundledGameData();
  const jobs = planJobs(data, {
    matches: options.matches,
    seed: options.seed,
    teamSize: options.teamSize,
    mergeSamples: options.mergeSamples,
    chunkSize: SIM_DEFAULTS.chunkSize,
  });
  const totalBattles = jobs.reduce((sum, job) => sum + battlesIn(data, job), 0);

  if (!options.quiet) {
    console.log('THRICEBOUND balance simulator');
    console.log(
      `  content     ${data.units.size} units, ${data.abilities.size} abilities, ${data.synergies.size} synergies`,
    );
    console.log(
      `  plan        ${options.matches.toLocaleString('en-US')} random matches + ` +
        `${options.mergeSamples} merge samples/option = ` +
        `${totalBattles.toLocaleString('en-US')} battles`,
    );
    console.log(`  workers     ${options.workers}  (${jobs.length} jobs)`);
    console.log('');
  }

  const startedAt = Date.now();
  let lastPrint = 0;
  const aggregate = await runJobsInPool(data, jobs, {
    workers: options.workers,
    onProgress: (done, total) => {
      if (options.quiet) return;
      const now = Date.now();
      if (done < total && now - lastPrint < 250) return;
      lastPrint = now;
      process.stdout.write(
        `\r  ${progressBar(done, total)} ${done.toLocaleString('en-US')}/${total.toLocaleString('en-US')}`,
      );
    },
  });
  const elapsedMs = Date.now() - startedAt;
  if (!options.quiet) {
    process.stdout.write('\n\n');
  }

  const runInfo = {
    matches: options.matches,
    seed: options.seed,
    workers: options.workers,
    teamSize: options.teamSize,
    mergeSamples: options.mergeSamples,
    battles: totalBattles,
    elapsedMs,
    generatedAt: new Date(startedAt).toISOString(),
  };

  const outDir = resolve(options.outDir);
  const baselinePath = options.baseline ?? join(outDir, SNAPSHOT_FILE);
  // Read before writing, or the new run would compare against itself.
  const baseline = await readBaseline(baselinePath);

  const warnings = collectWarnings(data, aggregate, runInfo);
  const regressions = findRegressions(aggregate, baseline);
  const skipped = missingMergeStudies(data, aggregate);

  if (options.writeReport) {
    await mkdir(outDir, { recursive: true });
    await Promise.all([
      writeFile(
        join(outDir, REPORT_FILE),
        renderMarkdown(data, aggregate, runInfo, warnings, regressions, baseline),
        'utf8',
      ),
      writeFile(join(outDir, 'units.csv'), unitsCsv(data, aggregate), 'utf8'),
      writeFile(join(outDir, 'synergies.csv'), synergiesCsv(aggregate), 'utf8'),
      writeFile(join(outDir, 'merge-paths.csv'), mergePathsCsv(data, aggregate), 'utf8'),
      writeFile(join(outDir, 'durations.csv'), durationsCsv(aggregate), 'utf8'),
    ]);
    // Written last, so a crash mid-report never leaves a snapshot that claims
    // to describe output that was not produced.
    await writeFile(
      join(outDir, SNAPSHOT_FILE),
      `${JSON.stringify(buildSnapshot(aggregate, runInfo), null, 2)}\n`,
      'utf8',
    );
  }

  if (!options.quiet) {
    const perSecond = elapsedMs > 0 ? (totalBattles / elapsedMs) * 1000 : 0;
    console.log(
      `  ${totalBattles.toLocaleString('en-US')} battles in ${(elapsedMs / 1000).toFixed(1)}s ` +
        `(${perSecond.toFixed(0)}/s)`,
    );
    console.log(
      `  outcomes    player ${aggregate.outcomes.player}  enemy ${aggregate.outcomes.enemy}  draw ${aggregate.outcomes.draw}`,
    );
    if (skipped.length > 0) {
      console.log(`  note        merge study skipped for ${skipped.length} decision(s)`);
    }
    console.log('');
    if (warnings.length === 0) {
      console.log('  no warnings');
    } else {
      console.log(`  ${warnings.length} warning(s):`);
      for (const warning of warnings) {
        console.log(`    [${warning.area}] ${warning.message}`);
      }
    }
    if (regressions.length > 0) {
      console.log('');
      console.log(`  ${regressions.length} unit(s) moved since the last report:`);
      for (const row of regressions) {
        const sign = row.deltaPp >= 0 ? '+' : '';
        console.log(
          `    ${data.units.get(row.unitId)?.name ?? row.unitId}: ` +
            `${(row.before * 100).toFixed(1)}% -> ${(row.after * 100).toFixed(1)}% ` +
            `(${sign}${row.deltaPp.toFixed(1)}pp)`,
        );
      }
    }
    if (options.writeReport) {
      console.log('');
      console.log(`  report      ${join(options.outDir, REPORT_FILE)}`);
    }
  }

  // A non-zero exit lets CI fail on a balance warning without parsing output.
  // Informational notes about coverage are not failures.
  return warnings.some((warning) => warning.severity === 'warn') ? 1 : 0;
}

async function main(): Promise<void> {
  let options: SimOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  process.exitCode = await run(options);
}

await main();

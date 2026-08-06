/**
 * Run pacing simulator.
 *
 *   npm run sim:runs -- --runs 1000 --seed 1
 *
 * Plays whole runs headless and reports how long they take, how far they get
 * and how each round performs. Writes a markdown report next to the balance
 * report; the console summary is the part you read while tuning.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadBundledGameData } from '../data/loader';
import { PACING } from './config';
import { formatDuration } from './pacing';
import { TARGET_BAND_SECONDS, simulateRuns } from './runsim';
import type { RunAggregate } from './runsim';

const REPORT_FILE = 'run-pacing.md';

interface Options {
  readonly runs: number;
  readonly seed: number;
  readonly outDir: string;
  readonly writeReport: boolean;
  readonly help: boolean;
}

const USAGE = `THRICEBOUND run pacing simulator

  npm run sim:runs -- [options]

Options:
  --runs N      runs to play          (default 1000)
  --seed N      base seed             (default 1)
  --out DIR     report directory      (default tools/reports)
  --no-report   analyse but write nothing
  --help        show this message`;

function parseArgs(argv: readonly string[]): Options {
  let runs = 1000;
  let seed = 1;
  let outDir = 'tools/reports';
  let writeReport = true;
  let help = false;

  const count = (raw: string | undefined, flag: string, min: number): number => {
    const value = Number(raw);
    if (raw === undefined || !Number.isInteger(value) || value < min) {
      throw new Error(`${flag} expects an integer >= ${min}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case '--runs':
        runs = count(argv[(i += 1)], flag, 1);
        break;
      case '--seed':
        seed = count(argv[(i += 1)], flag, 0);
        break;
      case '--out': {
        const value = argv[(i += 1)];
        if (value === undefined) throw new Error(`${flag} needs a value`);
        outDir = value;
        break;
      }
      case '--no-report':
        writeReport = false;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        throw new Error(`unknown option ${JSON.stringify(flag)}\n\n${USAGE}`);
    }
  }

  return { runs, seed, outDir, writeReport, help };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function renderMarkdown(aggregate: RunAggregate, options: Options, elapsedMs: number): string {
  const lines: string[] = [];
  const d = aggregate.duration;
  const v = aggregate.victoryDuration;

  lines.push('# Run pacing');
  lines.push('');
  lines.push(
    `${options.runs.toLocaleString('en-US')} runs, base seed ${options.seed}, ` +
      `simulated in ${(elapsedMs / 1000).toFixed(1)}s.`,
  );
  lines.push('');
  lines.push(
    'Battle time is **measured** — ticks times the tick size is exactly the ' +
      'playback the renderer produces at 1x. Decision counts are measured too. ' +
      'How long each decision takes a human is **estimated**, from the `PACING` ' +
      'constants in `src/sim/config.ts`.',
  );
  lines.push('');

  lines.push('## Duration');
  lines.push('');
  lines.push('| | All runs | Victories |');
  lines.push('| --- | --- | --- |');
  lines.push(`| mean | ${formatDuration(d.meanSeconds)} | ${formatDuration(v.meanSeconds)} |`);
  lines.push(
    `| median | ${formatDuration(d.medianSeconds)} | ${formatDuration(v.medianSeconds)} |`,
  );
  lines.push(`| p10 | ${formatDuration(d.p10Seconds)} | ${formatDuration(v.p10Seconds)} |`);
  lines.push(`| p90 | ${formatDuration(d.p90Seconds)} | ${formatDuration(v.p90Seconds)} |`);
  lines.push(`| min | ${formatDuration(d.minSeconds)} | ${formatDuration(v.minSeconds)} |`);
  lines.push(`| max | ${formatDuration(d.maxSeconds)} | ${formatDuration(v.maxSeconds)} |`);
  lines.push(
    `| in ${formatDuration(TARGET_BAND_SECONDS.min)}–${formatDuration(TARGET_BAND_SECONDS.max)} band | ` +
      `${pct(d.inTargetBand)} | ${pct(v.inTargetBand)} |`,
  );
  lines.push('');
  lines.push(
    `Split: ${formatDuration(d.meanBattleSeconds)} watching fights, ` +
      `${formatDuration(d.meanDecisionSeconds)} deciding.`,
  );
  lines.push('');

  lines.push('## Outcomes');
  lines.push('');
  lines.push(`- victories: ${aggregate.victories} (${pct(aggregate.victoryRate)})`);
  lines.push(`- defeats: ${aggregate.defeats}`);
  lines.push(`- mean rounds reached: ${aggregate.meanRoundsReached.toFixed(1)}`);
  lines.push('');

  lines.push('## Per round');
  lines.push('');
  lines.push('| Round | Reached | Win rate | Mean fight | Mean lives lost |');
  lines.push('| ---: | ---: | ---: | ---: | ---: |');
  for (const round of aggregate.perRound) {
    lines.push(
      `| ${round.round} | ${round.played} | ${pct(round.winRate)} | ` +
        `${round.meanSeconds.toFixed(1)}s | ${round.meanLivesLost.toFixed(1)} |`,
    );
  }
  lines.push('');

  lines.push('## Actions per run (mean)');
  lines.push('');
  const a = aggregate.meanActivity;
  lines.push('| Action | Count | Seconds each | Total |');
  lines.push('| --- | ---: | ---: | ---: |');
  const rows: [string, number, number][] = [
    ['shops opened', a.shopsVisited, PACING.shopReadSeconds + PACING.arrangeSeconds],
    ['purchases', a.purchases, PACING.purchaseSeconds],
    ['rerolls', a.rerolls, PACING.rerollSeconds],
    ['sells', a.sells, PACING.sellSeconds],
    ['merges', a.merges, PACING.mergeSeconds],
    ['reward choices', a.rewardChoices, PACING.rewardSeconds],
    ['battles', a.battles, PACING.battleStartSeconds + PACING.postBattleSeconds],
  ];
  for (const [label, countValue, each] of rows) {
    lines.push(
      `| ${label} | ${countValue.toFixed(1)} | ${each.toFixed(1)}s | ${(countValue * each).toFixed(0)}s |`,
    );
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  let options: Options;
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

  const data = loadBundledGameData();
  console.log('THRICEBOUND run pacing simulator');
  console.log(`  playing     ${options.runs.toLocaleString('en-US')} runs from seed ${options.seed}`);
  console.log('');

  const startedAt = Date.now();
  const aggregate = simulateRuns(data, options.seed, options.runs);
  const elapsedMs = Date.now() - startedAt;

  const d = aggregate.duration;
  console.log(
    `  duration    mean ${formatDuration(d.meanSeconds)}  median ${formatDuration(d.medianSeconds)}  ` +
      `p10 ${formatDuration(d.p10Seconds)}  p90 ${formatDuration(d.p90Seconds)}`,
  );
  console.log(
    `              ${formatDuration(d.meanBattleSeconds)} fighting + ${formatDuration(d.meanDecisionSeconds)} deciding`,
  );
  console.log(
    `              ${pct(d.inTargetBand)} inside the ` +
      `${formatDuration(TARGET_BAND_SECONDS.min)}-${formatDuration(TARGET_BAND_SECONDS.max)} target`,
  );
  console.log(
    `  victories   ${aggregate.victories}/${options.runs} (${pct(aggregate.victoryRate)}), ` +
      `mean round reached ${aggregate.meanRoundsReached.toFixed(1)}`,
  );
  console.log(
    `  victory run mean ${formatDuration(aggregate.victoryDuration.meanSeconds)}, ` +
      `${pct(aggregate.victoryDuration.inTargetBand)} in band`,
  );
  console.log('');
  console.log('  round  reached  winrate  fight   lives lost');
  for (const round of aggregate.perRound) {
    console.log(
      `  ${String(round.round).padStart(5)}  ${String(round.played).padStart(7)}  ` +
        `${pct(round.winRate).padStart(7)}  ${`${round.meanSeconds.toFixed(1)}s`.padStart(6)}  ` +
        `${round.meanLivesLost.toFixed(1).padStart(10)}`,
    );
  }
  console.log('');
  console.log(`  simulated in ${(elapsedMs / 1000).toFixed(1)}s`);

  if (options.writeReport) {
    const outDir = resolve(options.outDir);
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, REPORT_FILE),
      renderMarkdown(aggregate, options, elapsedMs),
      'utf8',
    );
    console.log(`  report      ${join(options.outDir, REPORT_FILE)}`);
  }
}

await main();

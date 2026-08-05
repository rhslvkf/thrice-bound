import { describe, expect, it } from 'vitest';
import { loadBundledGameData } from '../data/loader';
import { BOARD } from '../data/schema';
import { parseArgs } from './cli';
import { SIM_DEFAULTS } from './config';
import { battlesIn, planJobs, runJob } from './jobs';
import { mergePairs, mergePathSetups, randomSetup, rosterIds, slotsFor } from './matchup';

const data = loadBundledGameData();

describe('randomSetup', () => {
  it('is reproducible for a seed and index', () => {
    expect(randomSetup(data, 42, 7, 4)).toEqual(randomSetup(data, 42, 7, 4));
  });

  it('produces different matchups for different indices', () => {
    const a = JSON.stringify(randomSetup(data, 42, 1, 4));
    const b = JSON.stringify(randomSetup(data, 42, 2, 4));
    expect(a).not.toBe(b);
  });

  it('deploys each side on its own half', () => {
    for (let i = 0; i < 40; i += 1) {
      const setup = randomSetup(data, 1, i, 4);
      for (const deployment of setup.player) {
        expect(BOARD.playerRows).toContain(deployment.row);
      }
      for (const deployment of setup.enemy) {
        expect(BOARD.enemyRows).toContain(deployment.row);
      }
    }
  });

  it('never stacks two units on one cell', () => {
    for (let i = 0; i < 40; i += 1) {
      const setup = randomSetup(data, 1, i, 4);
      const cells = [...setup.player, ...setup.enemy].map((d) => `${d.col},${d.row}`);
      expect(new Set(cells).size).toBe(cells.length);
    }
  });

  it('only fields units that exist', () => {
    const ids = new Set(rosterIds(data));
    const setup = randomSetup(data, 1, 0, 4);
    for (const deployment of [...setup.player, ...setup.enemy]) {
      expect(ids.has(deployment.unitId)).toBe(true);
    }
  });
});

describe('slotsFor', () => {
  it('gives one distinct cell per unit', () => {
    const slots = slotsFor(BOARD.playerRows, 6);
    expect(slots).toHaveLength(6);
    expect(new Set(slots.map((s) => `${s.col},${s.row}`)).size).toBe(6);
  });

  it('is independent of which units go in it', () => {
    expect(slotsFor(BOARD.playerRows, 4)).toEqual(slotsFor(BOARD.playerRows, 4));
  });
});

describe('mergePairs', () => {
  it('covers every unit that offers a choice', () => {
    const pairs = mergePairs(data);
    const expected = [...data.units.values()].filter((u) => u.mergesInto.length > 1);
    expect(pairs).toHaveLength(expected.length);
    // 8 tier 1 units plus 12 tier 2 units, all of which branch.
    expect(pairs).toHaveLength(20);
  });

  it('is stably ordered, so job indices mean the same thing every run', () => {
    expect(mergePairs(data).map((p) => p.parentId)).toEqual(
      mergePairs(data).map((p) => p.parentId),
    );
  });

  it('excludes terminal units', () => {
    const ids = mergePairs(data).map((p) => p.parentId);
    expect(ids).not.toContain('unit.verdant_colossus');
  });
});

describe('mergePathSetups', () => {
  const pair = mergePairs(data).find((p) => p.parentId === 'unit.thornling');

  it('returns one setup per option', () => {
    expect(pair).toBeDefined();
    const setups = mergePathSetups(data, pair as never, 0, 1, 4);
    expect(setups).toHaveLength(pair?.options.length ?? 0);
  });

  it('changes only the studied slot between arms', () => {
    const setups = mergePathSetups(data, pair as never, 3, 1, 4);
    const [a, b] = setups;
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Identical enemy, identical supporting cast, identical battle seed —
    // this is what makes the comparison a controlled experiment rather than
    // two unrelated samples.
    expect(a?.enemy).toEqual(b?.enemy);
    expect(a?.seed).toBe(b?.seed);
    expect(a?.player.slice(1)).toEqual(b?.player.slice(1));
    expect(a?.player[0]?.unitId).not.toBe(b?.player[0]?.unitId);
    expect(a?.player[0]?.col).toBe(b?.player[0]?.col);
    expect(a?.player[0]?.row).toBe(b?.player[0]?.row);
  });

  it('puts the studied option in slot 0, in the pair order', () => {
    const setups = mergePathSetups(data, pair as never, 0, 1, 4);
    setups.forEach((setup, index) => {
      expect(setup.player[0]?.unitId).toBe(pair?.options[index]);
    });
  });

  it('is reproducible', () => {
    expect(mergePathSetups(data, pair as never, 5, 9, 4)).toEqual(
      mergePathSetups(data, pair as never, 5, 9, 4),
    );
  });

  it('varies between samples', () => {
    const a = JSON.stringify(mergePathSetups(data, pair as never, 1, 1, 4));
    const b = JSON.stringify(mergePathSetups(data, pair as never, 2, 1, 4));
    expect(a).not.toBe(b);
  });
});

describe('job planning', () => {
  const options = {
    matches: 1000,
    seed: 1,
    teamSize: 4,
    mergeSamples: 100,
    chunkSize: 250,
  };

  it('covers every match exactly once', () => {
    const jobs = planJobs(data, options).filter((job) => job.kind === 'random');
    const covered = new Set<number>();
    for (const job of jobs) {
      for (let i = 0; i < job.count; i += 1) covered.add(job.firstIndex + i);
    }
    expect(covered.size).toBe(options.matches);
  });

  it('covers every merge sample of every decision exactly once', () => {
    const jobs = planJobs(data, options).filter((job) => job.kind === 'merge');
    const covered = new Set<string>();
    for (const job of jobs) {
      for (let i = 0; i < job.count; i += 1) {
        covered.add(`${job.pairIndex}:${job.firstSample + i}`);
      }
    }
    expect(covered.size).toBe(mergePairs(data).length * options.mergeSamples);
  });

  it('skips the merge study when asked to', () => {
    const jobs = planJobs(data, { ...options, mergeSamples: 0 });
    expect(jobs.every((job) => job.kind === 'random')).toBe(true);
  });

  it('counts the battles a job will run', () => {
    const jobs = planJobs(data, options);
    const total = jobs.reduce((sum, job) => sum + battlesIn(data, job), 0);
    // Each merge sample runs one battle per option.
    const mergeBattles = mergePairs(data).reduce(
      (sum, pair) => sum + pair.options.length * options.mergeSamples,
      0,
    );
    expect(total).toBe(options.matches + mergeBattles);
  });

  it('produces the same aggregate however the work is chunked', () => {
    const small = planJobs(data, { ...options, matches: 200, mergeSamples: 0, chunkSize: 25 });
    const large = planJobs(data, { ...options, matches: 200, mergeSamples: 0, chunkSize: 200 });

    const fold = (jobs: ReturnType<typeof planJobs>) =>
      jobs
        .map((job) => runJob(data, job))
        .reduce((into, part) => {
          into.matches += part.matches;
          into.outcomes.player += part.outcomes.player;
          for (const [id, stat] of Object.entries(part.units)) {
            const target = (into.units[id] ??= { ...stat, presence: 0, presenceWins: 0, damageDealtMilli: 0 });
            target.presence += stat.presence;
            target.presenceWins += stat.presenceWins;
            target.damageDealtMilli += stat.damageDealtMilli;
          }
          return into;
        });

    const a = fold(small);
    const b = fold(large);
    expect(a.matches).toBe(b.matches);
    expect(a.outcomes.player).toBe(b.outcomes.player);
    for (const id of Object.keys(a.units)) {
      expect(a.units[id]?.presence, id).toBe(b.units[id]?.presence);
      expect(a.units[id]?.damageDealtMilli, id).toBe(b.units[id]?.damageDealtMilli);
    }
  });
});

describe('cli parsing', () => {
  it('applies defaults for an empty command line', () => {
    const options = parseArgs([]);
    expect(options.matches).toBe(SIM_DEFAULTS.matches);
    expect(options.seed).toBe(SIM_DEFAULTS.seed);
    expect(options.outDir).toBe(SIM_DEFAULTS.outDir);
    expect(options.writeReport).toBe(true);
    expect(options.workers).toBeGreaterThanOrEqual(1);
  });

  it('reads the documented invocation', () => {
    const options = parseArgs(['--matches', '10000', '--seed', '42']);
    expect(options.matches).toBe(10000);
    expect(options.seed).toBe(42);
  });

  it('reads every flag', () => {
    const options = parseArgs([
      '--matches', '5',
      '--seed', '6',
      '--workers', '2',
      '--team-size', '3',
      '--merge-samples', '0',
      '--out', 'somewhere',
      '--baseline', 'old.json',
      '--no-report',
      '--quiet',
    ]);
    expect(options).toMatchObject({
      matches: 5,
      seed: 6,
      workers: 2,
      teamSize: 3,
      mergeSamples: 0,
      outDir: 'somewhere',
      baseline: 'old.json',
      writeReport: false,
      quiet: true,
    });
  });

  it('rejects an unknown flag with the usage text', () => {
    expect(() => parseArgs(['--nope'])).toThrow('unknown option');
    expect(() => parseArgs(['--nope'])).toThrow('npm run sim');
  });

  it('rejects a missing value', () => {
    expect(() => parseArgs(['--matches'])).toThrow('needs a value');
  });

  it('rejects a non-integer or out-of-range value', () => {
    expect(() => parseArgs(['--matches', 'lots'])).toThrow('expects an integer');
    expect(() => parseArgs(['--matches', '1.5'])).toThrow('expects an integer');
    expect(() => parseArgs(['--matches', '0'])).toThrow('expects an integer >= 1');
  });

  it('allows zero merge samples but not zero matches', () => {
    expect(parseArgs(['--merge-samples', '0']).mergeSamples).toBe(0);
    expect(() => parseArgs(['--matches', '0'])).toThrow();
  });

  it('recognises --help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });
});

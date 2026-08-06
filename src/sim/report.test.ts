import { describe, expect, it } from 'vitest';
import { MAX_TICKS } from '../core/config';
import { loadBundledGameData } from '../data/loader';
import { THRESHOLDS } from './config';
import {
  emptyAggregate,
  emptyUnitStat,
  recordMergeSample,
  type Aggregate,
} from './metrics';
import {
  buildSnapshot,
  coverageWarnings,
  durationWarnings,
  findRegressions,
  gapMarginPp,
  mergePathWarnings,
  mergePathsCsv,
  renderMarkdown,
  tierBaselines,
  unitsCsv,
  unitWarnings,
  type RunInfo,
  type Snapshot,
} from './report';

const data = loadBundledGameData();

const RUN: RunInfo = {
  matches: 1000,
  seed: 1,
  workers: 4,
  teamSize: 4,
  mergeSamples: 300,
  battles: 1000,
  elapsedMs: 1000,
  generatedAt: '2026-08-05T00:00:00.000Z',
};

/** Builds an aggregate with a unit at a chosen win rate over `n` appearances. */
function withUnit(
  aggregate: Aggregate,
  unitId: string,
  wins: number,
  presence: number,
): Aggregate {
  const stat = emptyUnitStat();
  stat.presence = presence;
  stat.presenceWins = wins;
  stat.instances = presence;
  aggregate.units[unitId] = stat;
  return aggregate;
}

/** Fills a merge decision with two arms at chosen win rates. */
function withMerge(
  aggregate: Aggregate,
  parentId: string,
  a: { id: string; wins: number },
  b: { id: string; wins: number },
  samples: number,
): Aggregate {
  aggregate.mergePaths[`${parentId}>${a.id}`] = {
    parentId,
    optionId: a.id,
    samples,
    wins: a.wins,
    draws: 0,
  };
  aggregate.mergePaths[`${parentId}>${b.id}`] = {
    parentId,
    optionId: b.id,
    samples,
    wins: b.wins,
    draws: 0,
  };
  return aggregate;
}

// ---------------------------------------------------------------------------

describe('merge path warnings', () => {
  it('stays quiet when both branches are competitive', () => {
    const aggregate = withMerge(
      emptyAggregate(),
      'unit.thornling',
      { id: 'unit.moss_warden', wins: 152 },
      { id: 'unit.bramble_stalker', wins: 148 },
      300,
    );
    expect(mergePathWarnings(data, aggregate)).toEqual([]);
  });

  it('fires once the gap passes the limit', () => {
    // 60% against 40% is a 20pp gap, comfortably over the 8pp policy line.
    const aggregate = withMerge(
      emptyAggregate(),
      'unit.thornling',
      { id: 'unit.moss_warden', wins: 180 },
      { id: 'unit.bramble_stalker', wins: 120 },
      300,
    );
    const warnings = mergePathWarnings(data, aggregate);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.area).toBe('merge-path');
    expect(warnings[0]?.message).toContain('20.0pp gap');
    expect(warnings[0]?.message).toContain('Moss Warden');
    expect(warnings[0]?.message).toContain('an answer, not a choice');
  });

  it('does not fire exactly at the limit', () => {
    // Exactly 8pp: the rule is "more than", not "at least".
    const aggregate = withMerge(
      emptyAggregate(),
      'unit.thornling',
      { id: 'unit.moss_warden', wins: 162 },
      { id: 'unit.bramble_stalker', wins: 138 },
      300,
    );
    expect(mergePathWarnings(data, aggregate)).toEqual([]);
  });

  it('marks a flagged gap that is inside the sampling margin', () => {
    // A 10pp gap over 100 samples per arm carries a ~14pp margin, so the
    // warning must say so rather than presenting it as settled.
    const aggregate = withMerge(
      emptyAggregate(),
      'unit.thornling',
      { id: 'unit.moss_warden', wins: 55 },
      { id: 'unit.bramble_stalker', wins: 45 },
      100,
    );
    const warnings = mergePathWarnings(data, aggregate);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('sampling noise');
  });

  it('ignores decisions with too few samples to judge', () => {
    const aggregate = withMerge(
      emptyAggregate(),
      'unit.thornling',
      { id: 'unit.moss_warden', wins: 10 },
      { id: 'unit.bramble_stalker', wins: 0 },
      10,
    );
    expect(mergePathWarnings(data, aggregate)).toEqual([]);
  });

  it('shrinks the margin as samples grow', () => {
    const arms = (samples: number) => [
      { parentId: 'p', optionId: 'a', samples, wins: samples / 2, draws: 0 },
      { parentId: 'p', optionId: 'b', samples, wins: samples / 2, draws: 0 },
    ];
    expect(gapMarginPp(arms(1200))).toBeLessThan(gapMarginPp(arms(300)));
    expect(gapMarginPp(arms(300))).toBeLessThan(gapMarginPp(arms(100)));
  });
});

describe('duration warnings', () => {
  const histogramAt = (ticks: number, battles: number): number[] => {
    const histogram = new Array<number>(MAX_TICKS + 1).fill(0);
    histogram[ticks] = battles;
    return histogram;
  };

  it('stays quiet for battles of a readable length', () => {
    const aggregate = emptyAggregate();
    aggregate.matches = 100;
    aggregate.tickHistogram = histogramAt(400, 100);
    expect(durationWarnings(aggregate)).toEqual([]);
  });

  it('flags battles that end too fast to follow', () => {
    const aggregate = emptyAggregate();
    aggregate.matches = 100;
    aggregate.tickHistogram = histogramAt(50, 100);
    const warnings = durationWarnings(aggregate);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('below the');
  });

  it('flags battles that drag', () => {
    const aggregate = emptyAggregate();
    aggregate.matches = 100;
    aggregate.tickHistogram = histogramAt(900, 100);
    expect(durationWarnings(aggregate).some((w) => w.message.includes('drag'))).toBe(true);
  });

  it('flags a run where the clock decides too many matches', () => {
    const aggregate = emptyAggregate();
    aggregate.matches = 100;
    aggregate.reasons['timeout'] = 20;
    aggregate.tickHistogram = histogramAt(400, 100);
    expect(
      durationWarnings(aggregate).some((w) => w.message.includes('tick cap')),
    ).toBe(true);
  });
});

describe('unit warnings', () => {
  it('compares within a tier rather than against 50%', () => {
    // Three tier 3 units all winning ~70%: that is what tier 3 means, and
    // none of them is an outlier among its peers.
    const aggregate = emptyAggregate();
    withUnit(aggregate, 'unit.verdant_colossus', 700, 1000);
    withUnit(aggregate, 'unit.primal_avatar', 700, 1000);
    withUnit(aggregate, 'unit.lich_regent', 700, 1000);
    expect(unitWarnings(data, aggregate)).toEqual([]);
  });

  it('flags a unit that stands out among its own tier', () => {
    const aggregate = emptyAggregate();
    withUnit(aggregate, 'unit.verdant_colossus', 900, 1000);
    withUnit(aggregate, 'unit.primal_avatar', 600, 1000);
    withUnit(aggregate, 'unit.lich_regent', 600, 1000);

    const warnings = unitWarnings(data, aggregate);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('Verdant Colossus');
    expect(warnings[0]?.message).toContain('T3');
  });

  it('ignores units with too few appearances', () => {
    const aggregate = emptyAggregate();
    withUnit(aggregate, 'unit.verdant_colossus', 10, 10);
    withUnit(aggregate, 'unit.primal_avatar', 0, 10);
    expect(unitWarnings(data, aggregate)).toEqual([]);
  });

  it('uses a median baseline, so one outlier does not drag its peers', () => {
    const aggregate = emptyAggregate();
    withUnit(aggregate, 'unit.thornling', 100, 1000);
    withUnit(aggregate, 'unit.dire_pup', 500, 1000);
    withUnit(aggregate, 'unit.grave_rat', 900, 1000);
    // Mean and median coincide here; the point is the next case.
    expect(tierBaselines(data, aggregate).get(1)).toBeCloseTo(0.5, 6);

    const skewed = emptyAggregate();
    withUnit(skewed, 'unit.thornling', 500, 1000);
    withUnit(skewed, 'unit.dire_pup', 500, 1000);
    withUnit(skewed, 'unit.grave_rat', 990, 1000);
    // The mean would be 66%, flagging the two healthy units as underpowered.
    expect(tierBaselines(data, skewed).get(1)).toBeCloseTo(0.5, 6);
    expect(unitWarnings(data, skewed)).toHaveLength(1);
  });
});

describe('coverage warnings', () => {
  it('says when a synergy tier was never reachable', () => {
    const aggregate = emptyAggregate();
    aggregate.synergies['synergy.beast@5'] = {
      synergyId: 'synergy.beast',
      tag: 'Beast',
      thresholdCount: 5,
      activeTeams: 0,
      activeWins: 0,
      inactiveTeams: 900,
      inactiveWins: 400,
    };
    const warnings = coverageWarnings(aggregate, { ...RUN, teamSize: 4 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe('info');
    expect(warnings[0]?.message).toContain('never activated');
    expect(warnings[0]?.message).toContain('--team-size 5');
  });

  it('stays quiet when every tier was measured', () => {
    const aggregate = emptyAggregate();
    aggregate.synergies['synergy.beast@3'] = {
      synergyId: 'synergy.beast',
      tag: 'Beast',
      thresholdCount: 3,
      activeTeams: 100,
      activeWins: 50,
      inactiveTeams: 100,
      inactiveWins: 50,
    };
    expect(coverageWarnings(aggregate, RUN)).toEqual([]);
  });
});

describe('regression detection', () => {
  const baselineWith = (unitId: string, rate: number): Snapshot => ({
    version: 1,
    run: RUN,
    units: { [unitId]: { winRate: rate, presence: 1000 } },
    mergePaths: {},
  });

  it('reports nothing without a baseline', () => {
    expect(findRegressions(withUnit(emptyAggregate(), 'unit.thornling', 500, 1000), null))
      .toEqual([]);
  });

  it('ignores movement below the threshold', () => {
    const aggregate = withUnit(emptyAggregate(), 'unit.thornling', 530, 1000);
    expect(findRegressions(aggregate, baselineWith('unit.thornling', 0.5))).toEqual([]);
  });

  it('reports movement at or beyond the threshold, with direction', () => {
    const aggregate = withUnit(emptyAggregate(), 'unit.thornling', 600, 1000);
    const rows = findRegressions(aggregate, baselineWith('unit.thornling', 0.5));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deltaPp).toBeCloseTo(10, 6);
    expect(rows[0]?.before).toBeCloseTo(0.5, 6);
    expect(rows[0]?.after).toBeCloseTo(0.6, 6);
  });

  it('catches a drop as well as a rise', () => {
    const aggregate = withUnit(emptyAggregate(), 'unit.thornling', 400, 1000);
    const rows = findRegressions(aggregate, baselineWith('unit.thornling', 0.5));
    expect(rows[0]?.deltaPp).toBeCloseTo(-10, 6);
  });

  it('sorts by how far each unit moved', () => {
    const aggregate = emptyAggregate();
    withUnit(aggregate, 'unit.thornling', 600, 1000);
    withUnit(aggregate, 'unit.dire_pup', 800, 1000);
    const baseline: Snapshot = {
      version: 1,
      run: RUN,
      units: {
        'unit.thornling': { winRate: 0.5, presence: 1000 },
        'unit.dire_pup': { winRate: 0.5, presence: 1000 },
      },
      mergePaths: {},
    };
    expect(findRegressions(aggregate, baseline).map((r) => r.unitId)).toEqual([
      'unit.dire_pup',
      'unit.thornling',
    ]);
  });

  it('skips a unit that is new since the baseline', () => {
    const aggregate = withUnit(emptyAggregate(), 'unit.dire_pup', 900, 1000);
    expect(findRegressions(aggregate, baselineWith('unit.thornling', 0.5))).toEqual([]);
  });

  it('uses the configured threshold', () => {
    const justUnder = withUnit(
      emptyAggregate(),
      'unit.thornling',
      500 + (THRESHOLDS.regressionPp - 0.1) * 10,
      1000,
    );
    expect(findRegressions(justUnder, baselineWith('unit.thornling', 0.5))).toEqual([]);
  });
});

describe('snapshot', () => {
  it('emits keys in sorted order so diffs stay readable', () => {
    const aggregate = emptyAggregate();
    withUnit(aggregate, 'unit.thornling', 5, 10);
    withUnit(aggregate, 'unit.dire_pup', 5, 10);
    withUnit(aggregate, 'unit.grave_rat', 5, 10);
    expect(Object.keys(buildSnapshot(aggregate, RUN).units)).toEqual([
      'unit.dire_pup',
      'unit.grave_rat',
      'unit.thornling',
    ]);
  });

  it('round-trips through JSON, since that is how it is stored', () => {
    const aggregate = withUnit(emptyAggregate(), 'unit.thornling', 5, 10);
    const snapshot = buildSnapshot(aggregate, RUN);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('output formats', () => {
  const populated = (): Aggregate => {
    const aggregate = emptyAggregate();
    aggregate.matches = 1000;
    aggregate.outcomes = { player: 520, enemy: 470, draw: 10 };
    aggregate.reasons['wipe'] = 990;
    aggregate.reasons['timeout'] = 10;
    aggregate.tickHistogram[400] = 1000;
    withUnit(aggregate, 'unit.thornling', 400, 1000);
    withUnit(aggregate, 'unit.verdant_colossus', 700, 1000);
    withMerge(
      aggregate,
      'unit.thornling',
      { id: 'unit.moss_warden', wins: 180 },
      { id: 'unit.bramble_stalker', wins: 120 },
      300,
    );
    return aggregate;
  };

  it('writes a CSV with a header and one row per unit', () => {
    const lines = unitsCsv(data, populated()).trim().split('\n');
    expect(lines[0]).toContain('unit_id');
    expect(lines[0]).toContain('vs_tier_mean_pp');
    expect(lines).toHaveLength(3);
  });

  it('quotes CSV fields that contain a comma', () => {
    const aggregate = emptyAggregate();
    withUnit(aggregate, 'unit.titan_of_the_forge', 5, 10);
    const csv = unitsCsv(data, aggregate);
    // Tags are pipe-joined precisely so they never need quoting.
    expect(csv).not.toContain('""');
  });

  it('marks the over-limit merge decisions in its CSV', () => {
    const csv = mergePathsCsv(data, populated());
    expect(csv).toContain('gap_margin_pp');
    expect(csv.split('\n').filter((line) => line.endsWith('yes')).length).toBe(2);
  });

  it('renders markdown with every section, warnings first', () => {
    const aggregate = populated();
    const markdown = renderMarkdown(data, aggregate, RUN, mergePathWarnings(data, aggregate), [], null);
    for (const heading of [
      '# THRICEBOUND balance report',
      '## Warnings',
      '## Regressions',
      '## Outcomes',
      '## Battle length',
      '## Merge paths',
      '## Synergies',
      '## Units',
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown.indexOf('## Warnings')).toBeLessThan(markdown.indexOf('## Units'));
  });

  it('says so plainly when there is no baseline', () => {
    const aggregate = populated();
    const markdown = renderMarkdown(data, aggregate, RUN, [], [], null);
    expect(markdown).toContain('No previous report');
  });

  it('notes when the merge study was skipped', () => {
    const aggregate = emptyAggregate();
    aggregate.matches = 10;
    const markdown = renderMarkdown(data, aggregate, RUN, [], [], null);
    expect(markdown).toContain('Merge study skipped');
  });
});

describe('merge sample plumbing', () => {
  it('accumulates repeated samples for the same arm', () => {
    const aggregate = emptyAggregate();
    for (let i = 0; i < 5; i += 1) {
      recordMergeSample(aggregate, 'unit.thornling', 'unit.moss_warden', {
        outcome: i < 3 ? 'player' : 'enemy',
        reason: 'wipe',
        ticks: 100,
        events: [],
        finalState: {
          tick: 100,
          rngState: 0,
          units: [],
          periodics: [],
          nextInstanceId: 0,
    relicIds: [],
          startingHp: { player: 0, enemy: 0 },
          outcome: 'player',
          endReason: 'wipe',
        },
      });
    }
    const stat = aggregate.mergePaths['unit.thornling>unit.moss_warden'];
    expect(stat?.samples).toBe(5);
    expect(stat?.wins).toBe(3);
  });
});

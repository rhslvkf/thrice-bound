/**
 * Turning an aggregate into a report.
 *
 * Rendering is pure — it takes an aggregate and returns strings — so the
 * warning rules can be tested without running a simulation or touching disk.
 * `main.ts` owns the file writing.
 *
 * A snapshot (`latest.json`) is produced alongside the human-readable output.
 * It is what the next run compares against to detect regressions, so it holds
 * the numbers only, not the prose.
 */

import { BATTLE } from '../core/config';
import type { GameData } from '../data/schema';
import { DURATION_PERCENTILES, THRESHOLDS } from './config';
import { mergePairs } from './matchup';
import {
  avgDamageDealt,
  avgDamageTaken,
  avgSurvivalTicks,
  deathRate,
  mergeDecisions,
  mergeWinRate,
  summariseDurations,
  widestGapPp,
  winRate,
} from './metrics';
import type { Aggregate, MergePathStat } from './metrics';

export interface RunInfo {
  readonly matches: number;
  readonly seed: number;
  readonly workers: number;
  readonly teamSize: number;
  readonly mergeSamples: number;
  readonly battles: number;
  readonly elapsedMs: number;
  readonly generatedAt: string;
}

export const WARNING_SEVERITIES = ['warn', 'info'] as const;
export type WarningSeverity = (typeof WARNING_SEVERITIES)[number];

export interface Warning {
  readonly severity: WarningSeverity;
  readonly area: 'merge-path' | 'duration' | 'unit' | 'coverage';
  readonly message: string;
}

/** The machine-readable snapshot used as the next run's baseline. */
export interface Snapshot {
  readonly version: 1;
  readonly run: RunInfo;
  readonly units: Record<string, { winRate: number; presence: number }>;
  readonly mergePaths: Record<string, { winRate: number; samples: number }>;
}

/**
 * Slack for threshold comparisons.
 *
 * Win rates are ratios, so a gap that is exactly the limit can land a few
 * ULPs above it — `0.54 - 0.46` is `8.000000000000002`, not `8`. Without this,
 * a decision sitting precisely on the line would flip between runs.
 */
const COMPARISON_EPSILON = 1e-9;

const pct = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;
const pp = (points: number): string => `${points >= 0 ? '+' : ''}${points.toFixed(1)}pp`;
const ticksToSeconds = (ticks: number): string =>
  `${((ticks * BATTLE.tickMs) / BATTLE.msPerSecond).toFixed(1)}s`;

function nameOf(data: GameData, unitId: string): string {
  return data.units.get(unitId)?.name ?? unitId;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/**
 * 95% margin of error on the gap between two win rates, in points.
 *
 * Reported alongside every gap so a reader can tell a real imbalance from
 * sampling noise. A 12pp gap measured over 150 samples per arm carries a
 * margin of roughly 11pp; the same gap over 300 samples carries about 8pp.
 */
export function gapMarginPp(arms: readonly MergePathStat[]): number {
  const Z95 = 1.96;
  let variance = 0;
  for (const arm of arms) {
    if (arm.samples === 0) return Number.POSITIVE_INFINITY;
    const rate = mergeWinRate(arm);
    variance += (rate * (1 - rate)) / arm.samples;
  }
  return Z95 * Math.sqrt(variance) * 100;
}

/**
 * Flags merge decisions where one branch is simply better.
 *
 * This is the warning the whole tool exists for. A merge is meant to be a
 * choice; if one option wins by more than the configured gap, the player has
 * no decision left, only a correct answer to memorise.
 *
 * The threshold is applied exactly as specified — a gap over the limit is
 * flagged. The sampling margin is reported with it rather than used to
 * suppress the warning, so a borderline call is visible as borderline instead
 * of silently dropped.
 */
export function mergePathWarnings(data: GameData, aggregate: Aggregate): Warning[] {
  const warnings: Warning[] = [];
  for (const decision of mergeDecisions(aggregate)) {
    const gap = widestGapPp(decision.arms);
    const samples = Math.min(...decision.arms.map((arm) => arm.samples));
    if (samples < THRESHOLDS.minSamplesForWarning) continue;
    if (gap - THRESHOLDS.mergePathGapPp <= COMPARISON_EPSILON) continue;

    const ranked = [...decision.arms].sort((a, b) => mergeWinRate(b) - mergeWinRate(a));
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (best === undefined || worst === undefined) continue;

    const margin = gapMarginPp(decision.arms);
    const confident = gap > margin;

    warnings.push({
      severity: 'warn',
      area: 'merge-path',
      message:
        `${nameOf(data, decision.parentId)}: ` +
        `${nameOf(data, best.optionId)} ${pct(mergeWinRate(best))} vs ` +
        `${nameOf(data, worst.optionId)} ${pct(mergeWinRate(worst))} — ` +
        `${gap.toFixed(1)}pp gap (+/-${margin.toFixed(1)}pp, n=${samples}/arm), ` +
        `over the ${THRESHOLDS.mergePathGapPp}pp limit. ` +
        (confident
          ? 'The merge is an answer, not a choice.'
          : 'Within sampling noise — raise --merge-samples before acting.'),
    });
  }
  return warnings;
}

/** Flags battles that run too long or too short to read well. */
export function durationWarnings(aggregate: Aggregate): Warning[] {
  const warnings: Warning[] = [];
  const summary = summariseDurations(aggregate.tickHistogram, DURATION_PERCENTILES);
  if (summary.count === 0) return warnings;

  if (summary.mean < THRESHOLDS.minMeanTicks) {
    warnings.push({
      severity: 'warn',
      area: 'duration',
      message:
        `Mean battle is ${summary.mean.toFixed(0)} ticks (${ticksToSeconds(summary.mean)}), ` +
        `below the ${THRESHOLDS.minMeanTicks}-tick floor. Fights end before the player can read them.`,
    });
  }
  if (summary.mean > THRESHOLDS.maxMeanTicks) {
    warnings.push({
      severity: 'warn',
      area: 'duration',
      message:
        `Mean battle is ${summary.mean.toFixed(0)} ticks (${ticksToSeconds(summary.mean)}), ` +
        `above the ${THRESHOLDS.maxMeanTicks}-tick ceiling. Rounds drag.`,
    });
  }

  const timeouts = aggregate.reasons['timeout'] ?? 0;
  const rate = aggregate.matches > 0 ? timeouts / aggregate.matches : 0;
  if (rate > THRESHOLDS.maxTimeoutRate) {
    warnings.push({
      severity: 'warn',
      area: 'duration',
      message:
        `${pct(rate)} of battles hit the tick cap, over the ${pct(THRESHOLDS.maxTimeoutRate)} limit. ` +
        `The clock is deciding matches instead of the board.`,
    });
  }
  return warnings;
}

/**
 * Typical win rate within each tier: the **median**, not the mean.
 *
 * The mean is dragged by the very units this baseline exists to find. Three
 * tier 3 units at 90%, 60% and 60% average 70%, which flags all three — the
 * outlier for being high and its two healthy peers for being low. The median
 * sits at 60% and flags only the unit that is actually out of line.
 */
export function tierBaselines(data: GameData, aggregate: Aggregate): Map<number, number> {
  const byTier = new Map<number, number[]>();
  for (const [unitId, stat] of Object.entries(aggregate.units)) {
    const tier = data.units.get(unitId)?.tier;
    if (tier === undefined || stat.presence === 0) continue;
    const rates = byTier.get(tier) ?? [];
    rates.push(winRate(stat));
    byTier.set(tier, rates);
  }

  const medians = new Map<number, number>();
  for (const [tier, rates] of byTier) {
    rates.sort((a, b) => a - b);
    const middle = Math.floor(rates.length / 2);
    const median =
      rates.length % 2 === 1
        ? (rates[middle] ?? 0)
        : ((rates[middle - 1] ?? 0) + (rates[middle] ?? 0)) / 2;
    medians.set(tier, median);
  }
  return medians;
}

/**
 * Flags units that are outliers *within their own tier*.
 *
 * A tier 3 unit winning 70% of its matches is not a bug — that is what paying
 * six tier 1 units for it buys. What matters is whether a unit stands out from
 * the units a player actually chooses between, which is its own tier.
 */
export function unitWarnings(data: GameData, aggregate: Aggregate): Warning[] {
  const means = tierBaselines(data, aggregate);
  const warnings: Warning[] = [];

  for (const [unitId, stat] of Object.entries(aggregate.units)) {
    if (stat.presence < THRESHOLDS.minSamplesForWarning) continue;
    const tier = data.units.get(unitId)?.tier;
    if (tier === undefined) continue;
    const mean = means.get(tier);
    if (mean === undefined) continue;

    const deviationPp = (winRate(stat) - mean) * 100;
    if (Math.abs(deviationPp) - THRESHOLDS.unitTierDeviationPp <= COMPARISON_EPSILON) {
      continue;
    }

    warnings.push({
      severity: 'warn',
      area: 'unit',
      message:
        `${nameOf(data, unitId)} (T${tier}) wins ${pct(winRate(stat))} ` +
        `against a tier ${tier} median of ${pct(mean)} — ` +
        `${pp(deviationPp)}, n=${stat.presence}.`,
    });
  }
  return warnings.sort((a, b) => a.message.localeCompare(b.message));
}

/**
 * Flags metrics the run could not measure at all.
 *
 * A row of zeroes is easy to skim past and read as "no effect". It usually
 * means the opposite: the configuration never produced the situation. A
 * 5-unit synergy tier cannot trigger on a 4-unit team, so its win rate is not
 * low — it is unknown.
 */
export function coverageWarnings(aggregate: Aggregate, run: RunInfo): Warning[] {
  const warnings: Warning[] = [];
  const unreachable = Object.values(aggregate.synergies)
    .filter((stat) => stat.activeTeams === 0)
    .sort((a, b) =>
      a.tag === b.tag ? a.thresholdCount - b.thresholdCount : a.tag.localeCompare(b.tag),
    );

  if (unreachable.length > 0) {
    const highest = Math.max(...unreachable.map((stat) => stat.thresholdCount));
    warnings.push({
      severity: 'info',
      area: 'coverage',
      message:
        `${unreachable.length} synergy tier(s) never activated: ` +
        `${unreachable.map((s) => `${s.tag} ${s.thresholdCount}`).join(', ')}. ` +
        `Team size is ${run.teamSize}, and synergies count distinct unit types, ` +
        `so a ${highest}-unit tier is unreachable. ` +
        `Re-run with \`--team-size ${highest}\` or larger to measure them.`,
    });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Snapshot and regression
// ---------------------------------------------------------------------------

/**
 * Builds the baseline snapshot.
 *
 * Keys are emitted in sorted order. Worker threads finish in whatever order
 * they finish, so insertion order is not stable between runs, and an unstable
 * key order would make every `latest.json` diff look like a change.
 */
export function buildSnapshot(aggregate: Aggregate, run: RunInfo): Snapshot {
  const units: Snapshot['units'] = {};
  for (const unitId of Object.keys(aggregate.units).sort()) {
    const stat = aggregate.units[unitId];
    if (stat === undefined) continue;
    units[unitId] = { winRate: winRate(stat), presence: stat.presence };
  }
  const mergePaths: Snapshot['mergePaths'] = {};
  for (const key of Object.keys(aggregate.mergePaths).sort()) {
    const stat = aggregate.mergePaths[key];
    if (stat === undefined) continue;
    mergePaths[key] = { winRate: mergeWinRate(stat), samples: stat.samples };
  }
  return { version: 1, run, units, mergePaths };
}

export interface RegressionRow {
  readonly unitId: string;
  readonly before: number;
  readonly after: number;
  readonly deltaPp: number;
  readonly presence: number;
}

/**
 * Compares against a previous snapshot.
 *
 * Only units present in both runs are compared; a unit that was added or
 * removed has no meaningful delta. Rows are sorted by how far they moved.
 */
export function findRegressions(
  aggregate: Aggregate,
  baseline: Snapshot | null,
): RegressionRow[] {
  if (baseline === null) return [];
  const rows: RegressionRow[] = [];
  for (const [unitId, stat] of Object.entries(aggregate.units)) {
    const before = baseline.units[unitId];
    if (before === undefined) continue;
    const after = winRate(stat);
    const deltaPp = (after - before.winRate) * 100;
    if (Math.abs(deltaPp) < THRESHOLDS.regressionPp) continue;
    rows.push({
      unitId,
      before: before.winRate,
      after,
      deltaPp,
      presence: stat.presence,
    });
  }
  return rows.sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvRow(cells: readonly (string | number)[]): string {
  return cells
    .map((cell) => {
      const text = String(cell);
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    })
    .join(',');
}

export function unitsCsv(data: GameData, aggregate: Aggregate): string {
  const lines = [
    csvRow([
      'unit_id',
      'name',
      'tier',
      'tags',
      'presence',
      'win_rate',
      'instances',
      'death_rate',
      'avg_survival_ticks',
      'avg_damage_dealt',
      'avg_damage_taken',
      'vs_tier_mean_pp',
    ]),
  ];
  const means = tierBaselines(data, aggregate);
  const rows = Object.entries(aggregate.units).sort(
    (a, b) => winRate(b[1]) - winRate(a[1]),
  );
  for (const [unitId, stat] of rows) {
    const def = data.units.get(unitId);
    lines.push(
      csvRow([
        unitId,
        def?.name ?? unitId,
        def?.tier ?? '',
        def?.tags.join('|') ?? '',
        stat.presence,
        winRate(stat).toFixed(4),
        stat.instances,
        deathRate(stat).toFixed(4),
        avgSurvivalTicks(stat).toFixed(1),
        avgDamageDealt(stat).toFixed(1),
        avgDamageTaken(stat).toFixed(1),
        (
          (winRate(stat) - (means.get(def?.tier ?? -1) ?? winRate(stat))) *
          100
        ).toFixed(2),
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function synergiesCsv(aggregate: Aggregate): string {
  const lines = [
    csvRow([
      'synergy_id',
      'tag',
      'threshold',
      'active_teams',
      'active_win_rate',
      'inactive_teams',
      'inactive_win_rate',
      'delta_pp',
    ]),
  ];
  const rows = Object.values(aggregate.synergies).sort((a, b) =>
    a.synergyId === b.synergyId
      ? a.thresholdCount - b.thresholdCount
      : a.synergyId.localeCompare(b.synergyId),
  );
  for (const stat of rows) {
    const active = stat.activeTeams === 0 ? 0 : stat.activeWins / stat.activeTeams;
    const inactive =
      stat.inactiveTeams === 0 ? 0 : stat.inactiveWins / stat.inactiveTeams;
    lines.push(
      csvRow([
        stat.synergyId,
        stat.tag,
        stat.thresholdCount,
        stat.activeTeams,
        active.toFixed(4),
        stat.inactiveTeams,
        inactive.toFixed(4),
        ((active - inactive) * 100).toFixed(2),
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function mergePathsCsv(data: GameData, aggregate: Aggregate): string {
  const lines = [
    csvRow([
      'parent_id',
      'parent_name',
      'parent_tier',
      'option_id',
      'option_name',
      'samples',
      'win_rate',
      'gap_pp',
      'gap_margin_pp',
      'over_limit',
    ]),
  ];
  for (const decision of mergeDecisions(aggregate)) {
    const gap = widestGapPp(decision.arms);
    const margin = gapMarginPp(decision.arms);
    const parent = data.units.get(decision.parentId);
    for (const arm of decision.arms) {
      lines.push(
        csvRow([
          decision.parentId,
          parent?.name ?? decision.parentId,
          parent?.tier ?? '',
          arm.optionId,
          nameOf(data, arm.optionId),
          arm.samples,
          mergeWinRate(arm).toFixed(4),
          gap.toFixed(2),
          margin.toFixed(2),
          gap > THRESHOLDS.mergePathGapPp ? 'yes' : 'no',
        ]),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

export function durationsCsv(aggregate: Aggregate): string {
  const lines = [csvRow(['ticks', 'seconds', 'battles'])];
  for (let ticks = 0; ticks < aggregate.tickHistogram.length; ticks += 1) {
    const count = aggregate.tickHistogram[ticks] ?? 0;
    if (count === 0) continue;
    lines.push(
      csvRow([ticks, ((ticks * BATTLE.tickMs) / BATTLE.msPerSecond).toFixed(2), count]),
    );
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const divider = header.map(() => '---');
  return [header, divider, ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n');
}

/** Coarse buckets for the markdown histogram; the CSV keeps full resolution. */
function durationBuckets(aggregate: Aggregate): { label: string; count: number }[] {
  const width = 100;
  const buckets: { label: string; count: number }[] = [];
  for (let start = 0; start < aggregate.tickHistogram.length; start += width) {
    let count = 0;
    for (let i = start; i < Math.min(start + width, aggregate.tickHistogram.length); i += 1) {
      count += aggregate.tickHistogram[i] ?? 0;
    }
    buckets.push({ label: `${start}-${start + width - 1}`, count });
  }
  return buckets;
}

export function renderMarkdown(
  data: GameData,
  aggregate: Aggregate,
  run: RunInfo,
  warnings: readonly Warning[],
  regressions: readonly RegressionRow[],
  baseline: Snapshot | null,
): string {
  const out: string[] = [];
  const summary = summariseDurations(aggregate.tickHistogram, DURATION_PERCENTILES);

  out.push('# THRICEBOUND balance report');
  out.push('');
  out.push(
    `Generated ${run.generatedAt} — ${run.battles.toLocaleString('en-US')} battles ` +
      `in ${(run.elapsedMs / 1000).toFixed(1)}s on ${run.workers} worker(s).`,
  );
  out.push('');
  out.push(
    table(
      ['Setting', 'Value'],
      [
        ['Random matches', String(run.matches)],
        ['Merge samples per option', String(run.mergeSamples)],
        ['Team size', String(run.teamSize)],
        ['Seed', String(run.seed)],
        ['Tick', `${BATTLE.tickMs}ms`],
      ],
    ),
  );
  out.push('');

  // Warnings first: a report nobody scrolls is a report nobody acts on.
  out.push('## Warnings');
  out.push('');
  if (warnings.length === 0) {
    out.push('None. Every checked metric is inside its band.');
  } else {
    for (const warning of warnings) {
      const label = warning.severity === 'info' ? 'note' : warning.area;
      out.push(`- **[${label}]** ${warning.message}`);
    }
  }
  out.push('');

  out.push('## Regressions');
  out.push('');
  if (baseline === null) {
    out.push('No previous report to compare against. This run becomes the baseline.');
  } else if (regressions.length === 0) {
    out.push(
      `No unit moved by ${THRESHOLDS.regressionPp}pp or more since the previous run ` +
        `(${baseline.run.generatedAt}, ${baseline.run.matches} matches, seed ${baseline.run.seed}).`,
    );
  } else {
    out.push(
      `Compared against ${baseline.run.generatedAt} ` +
        `(${baseline.run.matches} matches, seed ${baseline.run.seed}). ` +
        `Note that a different seed or match count moves numbers on its own.`,
    );
    out.push('');
    out.push(
      table(
        ['Unit', 'Before', 'After', 'Change', 'n'],
        regressions.map((row) => [
          nameOf(data, row.unitId),
          pct(row.before),
          pct(row.after),
          pp(row.deltaPp),
          String(row.presence),
        ]),
      ),
    );
  }
  out.push('');

  out.push('## Outcomes');
  out.push('');
  const total = aggregate.matches || 1;
  out.push(
    table(
      ['Result', 'Share'],
      [
        ['Player win', pct(aggregate.outcomes.player / total)],
        ['Enemy win', pct(aggregate.outcomes.enemy / total)],
        ['Draw', pct(aggregate.outcomes.draw / total)],
        ...Object.entries(aggregate.reasons).map(([reason, count]) => [
          `Ended by ${reason}`,
          pct(count / total),
        ]),
      ],
    ),
  );
  out.push('');

  out.push('## Battle length');
  out.push('');
  out.push(
    table(
      ['Statistic', 'Ticks', 'Seconds'],
      [
        ['Mean', summary.mean.toFixed(0), ticksToSeconds(summary.mean)],
        ['Min', String(summary.min), ticksToSeconds(summary.min)],
        ['Max', String(summary.max), ticksToSeconds(summary.max)],
        ...DURATION_PERCENTILES.map((p) => [
          `p${p}`,
          String(summary.percentiles[p] ?? 0),
          ticksToSeconds(summary.percentiles[p] ?? 0),
        ]),
      ],
    ),
  );
  out.push('');
  out.push('Distribution (each block is 100 ticks / 5s):');
  out.push('');
  out.push('```');
  const buckets = durationBuckets(aggregate);
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.count));
  for (const bucket of buckets) {
    if (bucket.count === 0) continue;
    const bar = '#'.repeat(Math.max(1, Math.round((bucket.count / peak) * 40)));
    out.push(
      `${bucket.label.padStart(9)}  ${String(bucket.count).padStart(6)}  ${bar}`,
    );
  }
  out.push('```');
  out.push('');

  out.push('## Merge paths');
  out.push('');
  out.push(
    `Each row is a controlled pair: identical enemy, identical supporting cast, ` +
      `identical battle seed — only the merge choice differs. ` +
      `A gap above ${THRESHOLDS.mergePathGapPp}pp is flagged.`,
  );
  out.push('');
  const mergeRows: string[][] = [];
  for (const decision of [...mergeDecisions(aggregate)].sort(
    (a, b) => widestGapPp(b.arms) - widestGapPp(a.arms),
  )) {
    const gap = widestGapPp(decision.arms);
    const margin = gapMarginPp(decision.arms);
    const parent = data.units.get(decision.parentId);
    const flag =
      gap <= THRESHOLDS.mergePathGapPp ? '' : gap > margin ? '**over**' : 'over (noisy)';
    decision.arms.forEach((arm: MergePathStat, index: number) => {
      mergeRows.push([
        index === 0 ? `**${parent?.name ?? decision.parentId}** (T${parent?.tier ?? '?'})` : '',
        nameOf(data, arm.optionId),
        pct(mergeWinRate(arm)),
        String(arm.samples),
        index === 0 ? `${gap.toFixed(1)}pp` : '',
        index === 0 ? `+/-${margin.toFixed(1)}pp` : '',
        index === 0 ? flag : '',
      ]);
    });
  }
  out.push(
    mergeRows.length === 0
      ? '_Merge study skipped (`--merge-samples 0`)._'
      : table(
          ['Parent', 'Option', 'Win rate', 'n', 'Gap', '95% margin', 'Flag'],
          mergeRows,
        ),
  );
  out.push('');

  out.push('## Synergies');
  out.push('');
  out.push(
    '`Delta` is the win rate of teams running this tier minus the win rate of ' +
      'teams where the synergy is not active at all.',
  );
  out.push('');
  const synergyRows = Object.values(aggregate.synergies)
    .sort((a, b) =>
      a.synergyId === b.synergyId
        ? a.thresholdCount - b.thresholdCount
        : a.synergyId.localeCompare(b.synergyId),
    )
    .map((stat) => {
      const active = stat.activeTeams === 0 ? 0 : stat.activeWins / stat.activeTeams;
      const inactive =
        stat.inactiveTeams === 0 ? 0 : stat.inactiveWins / stat.inactiveTeams;
      return [
        stat.tag,
        String(stat.thresholdCount),
        stat.activeTeams === 0 ? '—' : pct(active),
        String(stat.activeTeams),
        pct(inactive),
        stat.activeTeams === 0 ? '—' : pp((active - inactive) * 100),
      ];
    });
  out.push(
    table(['Tag', 'Tier', 'Active win rate', 'n', 'Inactive win rate', 'Delta'], synergyRows),
  );
  out.push('');

  out.push('## Units');
  out.push('');
  out.push(
    'Sorted by win rate when present. Summoned bodies are excluded. ' +
      '`vs tier` is the gap to the median win rate of the same tier — the only ' +
      'comparison that means anything, since a tier 3 unit is meant to beat a ' +
      'tier 1 one.',
  );
  out.push('');
  const means = tierBaselines(data, aggregate);
  const unitRows = Object.entries(aggregate.units)
    .sort((a, b) => winRate(b[1]) - winRate(a[1]))
    .map(([unitId, stat]) => {
      const def = data.units.get(unitId);
      const mean = means.get(def?.tier ?? -1);
      return [
        nameOf(data, unitId),
        String(def?.tier ?? '?'),
        pct(winRate(stat)),
        mean === undefined ? '—' : pp((winRate(stat) - mean) * 100),
        String(stat.presence),
        ticksToSeconds(avgSurvivalTicks(stat)),
        avgDamageDealt(stat).toFixed(0),
        avgDamageTaken(stat).toFixed(0),
        pct(deathRate(stat)),
      ];
    });
  out.push(
    table(
      [
        'Unit',
        'T',
        'Win rate',
        'vs tier',
        'n',
        'Avg survival',
        'Dmg dealt',
        'Dmg taken',
        'Death rate',
      ],
      unitRows,
    ),
  );
  out.push('');

  out.push('---');
  out.push('');
  out.push(
    `Reproduce with \`npm run sim -- --matches ${run.matches} --seed ${run.seed}\`. ` +
      `Balance is tuned by editing \`src/data/*.json\` only — no code change is ` +
      `needed to move any number in this report.`,
  );
  out.push('');

  return out.join('\n');
}

/** Every warning the report knows how to raise. */
export function collectWarnings(
  data: GameData,
  aggregate: Aggregate,
  run: RunInfo,
): Warning[] {
  return [
    ...mergePathWarnings(data, aggregate),
    ...durationWarnings(aggregate),
    ...unitWarnings(data, aggregate),
    ...coverageWarnings(aggregate, run),
  ];
}

/** Merge decisions that exist in content but produced no samples. */
export function missingMergeStudies(data: GameData, aggregate: Aggregate): string[] {
  const studied = new Set(mergeDecisions(aggregate).map((decision) => decision.parentId));
  return mergePairs(data)
    .map((pair) => pair.parentId)
    .filter((parentId) => !studied.has(parentId));
}

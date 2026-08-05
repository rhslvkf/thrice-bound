/**
 * Turning battles into numbers.
 *
 * Everything here is pure and works on plain records, for two reasons: it is
 * unit-testable without running a battle, and an aggregate has to survive
 * `postMessage` from a worker thread back to the main one.
 *
 * Aggregates are **mergeable**: a worker builds one from its slice of the run
 * and the main thread folds them together. That is what makes the parallel
 * result identical to what a single thread would have produced.
 */

import type { BattleEvent, BattleResult, Team } from '../core/battle/index';
import { MAX_TICKS } from '../core/config';
import type { GameData } from '../data/schema';

/** Per-unit totals. Summoned units are excluded — see {@link recordBattle}. */
export interface UnitStat {
  /** (battle, team) pairs the unit appeared on. The win-rate denominator. */
  presence: number;
  presenceWins: number;
  presenceDraws: number;
  /** Individual bodies, which can exceed `presence` when a team doubles up. */
  instances: number;
  deaths: number;
  survivalTicks: number;
  /**
   * Damage in thousandths, as a whole number.
   *
   * Floats are summed in whatever order the workers happen to finish, and
   * float addition is not associative — accumulating raw damage made a
   * 4-worker run differ from a 1-worker run in the last few bits. Each
   * battle's contribution is rounded to an integer once, so merging is exact
   * and the report is reproducible regardless of how the work was split.
   * Divide by {@link DAMAGE_SCALE} to read them.
   */
  damageDealtMilli: number;
  damageTakenMilli: number;
}

/** Fixed-point scale for the damage accumulators. */
export const DAMAGE_SCALE = 1000;

/**
 * Per-synergy-tier totals.
 *
 * `inactive` counts teams where the synergy was not running *at all*, not
 * teams sitting on a lower tier. Comparing tier 5 against tier 3 would measure
 * the upgrade; comparing it against nothing measures the synergy.
 */
export interface SynergyStat {
  synergyId: string;
  tag: string;
  thresholdCount: number;
  activeTeams: number;
  activeWins: number;
  inactiveTeams: number;
  inactiveWins: number;
}

/** One arm of a merge decision. */
export interface MergePathStat {
  parentId: string;
  optionId: string;
  samples: number;
  wins: number;
  draws: number;
}

export interface Aggregate {
  matches: number;
  outcomes: Record<Team | 'draw', number>;
  reasons: Record<string, number>;
  units: Record<string, UnitStat>;
  synergies: Record<string, SynergyStat>;
  mergePaths: Record<string, MergePathStat>;
  /**
   * Battles indexed by tick count. Fixed length, so it merges by addition and
   * yields exact percentiles without keeping every battle's duration.
   */
  tickHistogram: number[];
}

export function emptyUnitStat(): UnitStat {
  return {
    presence: 0,
    presenceWins: 0,
    presenceDraws: 0,
    instances: 0,
    deaths: 0,
    survivalTicks: 0,
    damageDealtMilli: 0,
    damageTakenMilli: 0,
  };
}

export function emptyAggregate(): Aggregate {
  return {
    matches: 0,
    outcomes: { player: 0, enemy: 0, draw: 0 },
    reasons: {},
    units: {},
    synergies: {},
    mergePaths: {},
    tickHistogram: new Array<number>(MAX_TICKS + 1).fill(0),
  };
}

const mergeKey = (parentId: string, optionId: string): string => `${parentId}>${optionId}`;
const synergyKey = (synergyId: string, threshold: number): string =>
  `${synergyId}@${threshold}`;

/** What one battle contributed, before it is folded into an aggregate. */
interface BattleFacts {
  /** Units per team, excluding summons, deduplicated. */
  readonly present: Record<Team, Set<string>>;
  /** Per-instance rows, one per non-summoned body. */
  readonly bodies: readonly {
    defId: string;
    team: Team;
    died: boolean;
    survivalTicks: number;
    damageDealt: number;
    damageTaken: number;
  }[];
  /** Highest synergy tier each team had running, by synergy id. */
  readonly synergyTiers: Record<Team, Map<string, number>>;
}

/**
 * Walks a battle's event log once and extracts everything the report needs.
 *
 * Summoned units are left out of per-unit statistics: nobody chose to field
 * them, and counting a Grave Rat raised by an ability as an appearance would
 * distort its win rate. Their contribution shows up in the win rate of the
 * unit that summoned them, which is where it belongs.
 */
function extractFacts(result: BattleResult): BattleFacts {
  interface Body {
    defId: string;
    team: Team;
    summoned: boolean;
    deathTick: number | null;
    damageDealt: number;
    damageTaken: number;
  }
  const bodies = new Map<number, Body>();
  const synergyTiers: Record<Team, Map<string, number>> = {
    player: new Map(),
    enemy: new Map(),
  };

  for (const event of result.events as readonly BattleEvent[]) {
    switch (event.kind) {
      case 'spawn':
        bodies.set(event.instanceId, {
          defId: event.defId,
          team: event.team,
          summoned: event.summoned,
          deathTick: null,
          damageDealt: 0,
          damageTaken: 0,
        });
        break;

      case 'damage': {
        const target = bodies.get(event.targetId);
        if (target !== undefined) target.damageTaken += event.amount;
        if (event.sourceId !== null) {
          const source = bodies.get(event.sourceId);
          // Self-damage and friendly fire would otherwise inflate output.
          if (source !== undefined && source.team !== target?.team) {
            source.damageDealt += event.amount;
          }
        }
        break;
      }

      case 'death': {
        const body = bodies.get(event.instanceId);
        if (body !== undefined) body.deathTick = event.tick;
        break;
      }

      case 'synergyApplied': {
        const tiers = synergyTiers[event.team];
        tiers.set(
          event.synergyId,
          Math.max(tiers.get(event.synergyId) ?? 0, event.thresholdCount),
        );
        break;
      }

      default:
        break;
    }
  }

  const present: Record<Team, Set<string>> = { player: new Set(), enemy: new Set() };
  const rows: BattleFacts['bodies'][number][] = [];
  for (const body of bodies.values()) {
    if (body.summoned) continue;
    present[body.team].add(body.defId);
    rows.push({
      defId: body.defId,
      team: body.team,
      died: body.deathTick !== null,
      survivalTicks: body.deathTick ?? result.ticks,
      damageDealt: body.damageDealt,
      damageTaken: body.damageTaken,
    });
  }

  return { present, bodies: rows, synergyTiers };
}

/** Folds one battle into an aggregate. */
export function recordBattle(
  aggregate: Aggregate,
  data: GameData,
  result: BattleResult,
): void {
  const facts = extractFacts(result);

  aggregate.matches += 1;
  aggregate.outcomes[result.outcome] += 1;
  aggregate.reasons[result.reason] = (aggregate.reasons[result.reason] ?? 0) + 1;

  const index = Math.min(result.ticks, MAX_TICKS);
  aggregate.tickHistogram[index] = (aggregate.tickHistogram[index] ?? 0) + 1;

  for (const team of ['player', 'enemy'] as const) {
    const won = result.outcome === team;
    const drew = result.outcome === 'draw';

    for (const defId of facts.present[team]) {
      const stat = (aggregate.units[defId] ??= emptyUnitStat());
      stat.presence += 1;
      if (won) stat.presenceWins += 1;
      if (drew) stat.presenceDraws += 1;
    }

    for (const synergy of data.synergies.values()) {
      const activeTier = facts.synergyTiers[team].get(synergy.id);
      for (const threshold of synergy.thresholds) {
        const key = synergyKey(synergy.id, threshold.count);
        const stat = (aggregate.synergies[key] ??= {
          synergyId: synergy.id,
          tag: synergy.tag,
          thresholdCount: threshold.count,
          activeTeams: 0,
          activeWins: 0,
          inactiveTeams: 0,
          inactiveWins: 0,
        });
        if (activeTier === threshold.count) {
          stat.activeTeams += 1;
          if (won) stat.activeWins += 1;
        } else if (activeTier === undefined) {
          stat.inactiveTeams += 1;
          if (won) stat.inactiveWins += 1;
        }
      }
    }
  }

  for (const body of facts.bodies) {
    const stat = (aggregate.units[body.defId] ??= emptyUnitStat());
    stat.instances += 1;
    if (body.died) stat.deaths += 1;
    stat.survivalTicks += body.survivalTicks;
    // Rounded here, once per body per battle, so every later addition is exact.
    stat.damageDealtMilli += Math.round(body.damageDealt * DAMAGE_SCALE);
    stat.damageTakenMilli += Math.round(body.damageTaken * DAMAGE_SCALE);
  }
}

/**
 * Records one arm of a merge comparison.
 *
 * The studied unit is always on the player side, so `outcome === 'player'`
 * means this option won its paired battle.
 */
export function recordMergeSample(
  aggregate: Aggregate,
  parentId: string,
  optionId: string,
  result: BattleResult,
): void {
  const key = mergeKey(parentId, optionId);
  const stat = (aggregate.mergePaths[key] ??= {
    parentId,
    optionId,
    samples: 0,
    wins: 0,
    draws: 0,
  });
  stat.samples += 1;
  if (result.outcome === 'player') stat.wins += 1;
  if (result.outcome === 'draw') stat.draws += 1;
}

/** Adds `source` into `target`. Used to fold worker results together. */
export function mergeAggregates(target: Aggregate, source: Aggregate): Aggregate {
  target.matches += source.matches;
  for (const key of ['player', 'enemy', 'draw'] as const) {
    target.outcomes[key] += source.outcomes[key];
  }
  for (const [reason, count] of Object.entries(source.reasons)) {
    target.reasons[reason] = (target.reasons[reason] ?? 0) + count;
  }

  for (const [defId, stat] of Object.entries(source.units)) {
    const into = (target.units[defId] ??= emptyUnitStat());
    into.presence += stat.presence;
    into.presenceWins += stat.presenceWins;
    into.presenceDraws += stat.presenceDraws;
    into.instances += stat.instances;
    into.deaths += stat.deaths;
    into.survivalTicks += stat.survivalTicks;
    into.damageDealtMilli += stat.damageDealtMilli;
    into.damageTakenMilli += stat.damageTakenMilli;
  }

  for (const [key, stat] of Object.entries(source.synergies)) {
    const into = (target.synergies[key] ??= { ...stat, activeTeams: 0, activeWins: 0, inactiveTeams: 0, inactiveWins: 0 });
    into.activeTeams += stat.activeTeams;
    into.activeWins += stat.activeWins;
    into.inactiveTeams += stat.inactiveTeams;
    into.inactiveWins += stat.inactiveWins;
  }

  for (const [key, stat] of Object.entries(source.mergePaths)) {
    const into = (target.mergePaths[key] ??= { ...stat, samples: 0, wins: 0, draws: 0 });
    into.samples += stat.samples;
    into.wins += stat.wins;
    into.draws += stat.draws;
  }

  for (let i = 0; i < target.tickHistogram.length; i += 1) {
    target.tickHistogram[i] = (target.tickHistogram[i] ?? 0) + (source.tickHistogram[i] ?? 0);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

/**
 * Win rate as a fraction of appearances.
 *
 * Draws count as half a win. Treating them as losses would punish the
 * defensive builds that produce them, and dropping them would quietly shrink
 * the sample.
 */
export function winRate(stat: {
  presence: number;
  presenceWins: number;
  presenceDraws: number;
}): number {
  if (stat.presence === 0) return 0;
  return (stat.presenceWins + stat.presenceDraws / 2) / stat.presence;
}

/** Average damage dealt per body, in whole damage units. */
export function avgDamageDealt(stat: UnitStat): number {
  if (stat.instances === 0) return 0;
  return stat.damageDealtMilli / DAMAGE_SCALE / stat.instances;
}

/** Average damage taken per body, in whole damage units. */
export function avgDamageTaken(stat: UnitStat): number {
  if (stat.instances === 0) return 0;
  return stat.damageTakenMilli / DAMAGE_SCALE / stat.instances;
}

/** Average ticks survived per body. */
export function avgSurvivalTicks(stat: UnitStat): number {
  if (stat.instances === 0) return 0;
  return stat.survivalTicks / stat.instances;
}

/** Share of bodies that died rather than surviving to the end. */
export function deathRate(stat: UnitStat): number {
  if (stat.instances === 0) return 0;
  return stat.deaths / stat.instances;
}

export function mergeWinRate(stat: MergePathStat): number {
  if (stat.samples === 0) return 0;
  return (stat.wins + stat.draws / 2) / stat.samples;
}

export interface DurationSummary {
  readonly count: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly percentiles: Record<number, number>;
}

/** Exact percentiles, read straight out of the histogram. */
export function summariseDurations(
  histogram: readonly number[],
  percentiles: readonly number[],
): DurationSummary {
  let count = 0;
  let total = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (let ticks = 0; ticks < histogram.length; ticks += 1) {
    const n = histogram[ticks] ?? 0;
    if (n === 0) continue;
    count += n;
    total += n * ticks;
    min = Math.min(min, ticks);
    max = Math.max(max, ticks);
  }
  if (count === 0) {
    return { count: 0, mean: 0, min: 0, max: 0, percentiles: {} };
  }

  const marks: Record<number, number> = {};
  for (const p of percentiles) {
    const rank = Math.max(1, Math.ceil((p / 100) * count));
    let seen = 0;
    for (let ticks = 0; ticks < histogram.length; ticks += 1) {
      seen += histogram[ticks] ?? 0;
      if (seen >= rank) {
        marks[p] = ticks;
        break;
      }
    }
  }
  return { count, mean: total / count, min, max, percentiles: marks };
}

/** Groups merge-path arms by their parent decision. */
export function mergeDecisions(
  aggregate: Aggregate,
): { parentId: string; arms: MergePathStat[] }[] {
  const byParent = new Map<string, MergePathStat[]>();
  for (const stat of Object.values(aggregate.mergePaths)) {
    const arms = byParent.get(stat.parentId) ?? [];
    arms.push(stat);
    byParent.set(stat.parentId, arms);
  }
  return [...byParent.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([parentId, arms]) => ({
      parentId,
      arms: arms.sort((a, b) => (a.optionId < b.optionId ? -1 : 1)),
    }));
}

/** Largest win-rate gap between any two arms of a decision, in points. */
export function widestGapPp(arms: readonly MergePathStat[]): number {
  if (arms.length < 2) return 0;
  const rates = arms.map(mergeWinRate);
  return (Math.max(...rates) - Math.min(...rates)) * 100;
}

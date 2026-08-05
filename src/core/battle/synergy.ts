/**
 * Synergy resolution.
 *
 * Synergies are counted and applied **once, at battle start**, and never
 * recomputed: a unit dying mid-fight does not switch off the bonus its
 * presence enabled. That makes the pre-battle board the thing the player is
 * actually optimising, and it keeps the tick loop free of per-tick recounting.
 *
 * Counting is by **distinct unit definition**, not by body — see
 * `SYNERGY.countsDistinctUnitTypes`. Three Grave Rats are one Undead; a Grave
 * Rat, a Rot Knight and a Crypt Weaver are three. This is what gives the
 * merge-direction choice weight, since merging into a dual-tag unit can open a
 * tag you did not have.
 */

import type { SynergyDef, SynergyThreshold, UnitTag } from '../../data/schema';
import { SYNERGY } from '../config';
import type { BattleContext } from './context';
import { emit, livingOf } from './context';
import { applyEffects, registerTeamPeriodic } from './effects';
import type { BattleUnit, Team } from './types';
import { TEAMS } from './types';

/** Units on a team that count toward synergies. */
function countingUnits(ctx: BattleContext, team: Team): BattleUnit[] {
  return livingOf(ctx, team).filter(
    (unit) => SYNERGY.summonsCount || !unit.summoned,
  );
}

/** How many units on a team carry a tag, under the configured counting rule. */
export function tagCount(ctx: BattleContext, team: Team, tag: UnitTag): number {
  const units = countingUnits(ctx, team).filter((unit) => unit.tags.includes(tag));
  if (!SYNERGY.countsDistinctUnitTypes) return units.length;
  return new Set(units.map((unit) => unit.defId)).size;
}

/**
 * The highest threshold a count satisfies, or `null` if none do.
 *
 * Thresholds are validated ascending by the content loader, so the last
 * satisfied one is the highest.
 */
export function satisfiedThreshold(
  synergy: SynergyDef,
  count: number,
): SynergyThreshold | null {
  let best: SynergyThreshold | null = null;
  for (const threshold of synergy.thresholds) {
    if (count >= threshold.count) best = threshold;
  }
  return best;
}

/**
 * Applies every satisfied synergy for both teams.
 *
 * Only one tier of a given synergy applies — the highest satisfied one, not
 * all of them cumulatively.
 */
export function applySynergies(ctx: BattleContext): void {
  // Iterated in fixed order (teams, then synergy id) so the effects land in
  // the same sequence on every run.
  const synergies = [...ctx.data.synergies.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  for (const team of TEAMS) {
    for (const synergy of synergies) {
      const count = tagCount(ctx, team, synergy.tag);
      const threshold = satisfiedThreshold(synergy, count);
      if (threshold === null) continue;

      // A synergy is a team-wide aura with no single owner, but effects need a
      // source unit to resolve `alliesWithTag` against. The lowest-id living
      // unit on the team stands in; every selector a synergy uses is
      // team-relative, so which member it is does not change the outcome.
      const anchor = countingUnits(ctx, team).sort(
        (a, b) => a.instanceId - b.instanceId,
      )[0];
      if (anchor === undefined) continue;

      // Periodics are registered as team auras rather than owned by the
      // anchor, so the regeneration does not stop when that unit falls.
      for (const effect of threshold.effects) {
        if (effect.kind === 'periodic') registerTeamPeriodic(ctx, effect, team);
      }
      const affected = applyEffects(
        ctx,
        threshold.effects.filter((effect) => effect.kind !== 'periodic'),
        { sourceId: anchor.instanceId, eventSourceId: null, attackTargetId: null },
      );

      emit(ctx, {
        kind: 'synergyApplied',
        team,
        synergyId: synergy.id,
        tag: synergy.tag,
        unitCount: count,
        thresholdCount: threshold.count,
        description: threshold.description,
        affectedIds: affected.map((unit) => unit.instanceId),
      });
    }
  }
}

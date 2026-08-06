/**
 * Relics, inside a battle.
 *
 * A relic is a modifier the player carries between rounds, and three of its
 * triggers land here: `onBattleStart`, `onAllyDamaged` and `onUnitDeath`. The
 * rest — gold, rerolls, shop odds — are the run loop's business and never reach
 * this folder.
 *
 * Relics reuse the `Effect` vocabulary rather than getting one of their own, so
 * a relic that grants a shield and an ability that grants a shield take exactly
 * the same code path. Adding a relic is a content edit.
 *
 * Two rules keep this deterministic:
 *
 * - Relics are applied in the order the player collected them, which is the
 *   order they are stored in run state — never in `Map` iteration order.
 * - `chance` is rolled against the battle's own seeded RNG, and only when it is
 *   below 1, so a guaranteed relic never shifts the stream for anything else.
 */

import type { RelicCondition, RelicDef, RelicHook } from '../../data/schema';
import type { BattleContext } from './context';
import { livingOf, unitById } from './context';
import { applyEffects } from './effects';
import { tagCount } from './synergy';
import type { BattleUnit, EffectContext } from './types';

/** Relics only ever belong to the player; enemies are content, not runs. */
const RELIC_TEAM = 'player';

function relicsOf(ctx: BattleContext): RelicDef[] {
  const defs: RelicDef[] = [];
  for (const id of ctx.relicIds) {
    const relic = ctx.data.relics.get(id);
    if (relic !== undefined) defs.push(relic);
  }
  return defs;
}

/**
 * Whether a hook's condition holds.
 *
 * `roundAtLeast` and `goldAtMost` are run-state conditions that a battle cannot
 * answer, and the content loader rejects them on battle triggers — so reaching
 * one here means the data changed without the check being updated, and refusing
 * to fire is the safe reading.
 */
function conditionHolds(ctx: BattleContext, condition: RelicCondition): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'tagCountAtLeast':
      if (condition.tag === null || condition.value === null) return false;
      return tagCount(ctx, RELIC_TEAM, condition.tag) >= condition.value;
    case 'roundAtLeast':
    case 'goldAtMost':
      return false;
  }
}

function shouldFire(ctx: BattleContext, hook: RelicHook): boolean {
  if (!conditionHolds(ctx, hook.condition)) return false;
  if (hook.chance >= 1) return true;
  return ctx.rng.nextBool(hook.chance);
}

/** Runs every `applyEffect` action on a hook. Other action kinds are run-loop
 *  business and are skipped here rather than being an error. */
function runHook(ctx: BattleContext, hook: RelicHook, effectCtx: EffectContext): void {
  const effects = hook.actions
    .filter((action) => action.kind === 'applyEffect')
    .map((action) => action.effect);
  if (effects.length > 0) applyEffects(ctx, effects, effectCtx);
}

/**
 * Applies `onBattleStart` relics.
 *
 * Called after synergies so a relic conditioned on a tag count sees the same
 * board the synergy did, and before starting HP is measured so a `+15% max HP`
 * relic counts toward the timeout rule rather than reading as instant damage.
 *
 * Effects are anchored on the lowest-id player unit, the same convention
 * synergies use: every selector a relic can name is team-relative, so which
 * member anchors it does not change the outcome.
 */
export function applyBattleStartRelics(ctx: BattleContext): void {
  if (ctx.relicIds.length === 0) return;

  const anchor = livingOf(ctx, RELIC_TEAM).sort(
    (a, b) => a.instanceId - b.instanceId,
  )[0];
  if (anchor === undefined) return;

  for (const relic of relicsOf(ctx)) {
    for (const hook of relic.hooks) {
      if (hook.on !== 'onBattleStart') continue;
      if (!shouldFire(ctx, hook)) continue;
      runHook(ctx, hook, {
        sourceId: anchor.instanceId,
        eventSourceId: null,
        attackTargetId: null,
      });
    }
  }
}

/**
 * Applies `onAllyDamaged` relics.
 *
 * `self` resolves to the ally that was struck and `eventSource` to whatever
 * struck it, so a relic can either protect the victim or punish the attacker
 * without needing a vocabulary of its own.
 *
 * Fires only for the player's units — a relic is the player's, and an enemy
 * taking a hit is not the trigger.
 */
export function applyDamagedRelics(
  ctx: BattleContext,
  victim: BattleUnit,
  attackerId: number | null,
): void {
  if (ctx.relicIds.length === 0 || victim.team !== RELIC_TEAM) return;

  for (const relic of relicsOf(ctx)) {
    for (const hook of relic.hooks) {
      if (hook.on !== 'onAllyDamaged') continue;
      if (!shouldFire(ctx, hook)) continue;
      runHook(ctx, hook, {
        sourceId: victim.instanceId,
        eventSourceId: attackerId,
        attackTargetId: null,
      });
    }
  }
}

/**
 * Applies `onUnitDeath` relics.
 *
 * Anchored on the corpse, exactly as an `onDeath` ability is: `allAllies` and
 * `allEnemies` are resolved from the source's team, which a dead unit still
 * has. Effects that would land *on* the corpse are dropped downstream.
 */
export function applyDeathRelics(
  ctx: BattleContext,
  dead: BattleUnit,
  killerId: number | null,
): void {
  if (ctx.relicIds.length === 0 || dead.team !== RELIC_TEAM) return;

  for (const relic of relicsOf(ctx)) {
    for (const hook of relic.hooks) {
      if (hook.on !== 'onUnitDeath') continue;
      if (!shouldFire(ctx, hook)) continue;
      runHook(ctx, hook, {
        sourceId: dead.instanceId,
        eventSourceId: killerId,
        attackTargetId: null,
      });
    }
  }
}

/** Resolves an instance id for tests and callers that need the unit back. */
export function relicSubject(ctx: BattleContext, id: number | null): BattleUnit | null {
  return unitById(ctx, id);
}

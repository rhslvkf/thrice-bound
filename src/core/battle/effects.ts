/**
 * Effect resolution.
 *
 * Abilities, synergies and (eventually) relics all describe what they do with
 * the same `Effect` vocabulary from `src/data`, and all of them land here.
 * Adding an ability is a content edit; only a genuinely new *kind* of effect
 * touches this file.
 */

import type { Effect } from '../../data/schema';
import type { BattleContext } from './context';
import { emit, livingOf, unitById } from './context';
import { addShield, dealDamage, heal, outgoingDamage } from './damage';
import { freeCellsNear } from './grid';
import { spawnUnit } from './spawn';
import { addMod, effectiveStat } from './stats';
import { resolveTargets } from './targeting';
import type { ActivePeriodic, BattleUnit, EffectContext, Team } from './types';

/**
 * Applies one effect and returns the units it landed on.
 *
 * `periodic` is the exception: it lands on nobody now, registering itself to
 * fire on a schedule instead.
 */
export function applyEffect(
  ctx: BattleContext,
  effect: Effect,
  effectCtx: EffectContext,
): BattleUnit[] {
  const source = unitById(ctx, effectCtx.sourceId);

  if (effect.kind === 'periodic') {
    registerPeriodic(ctx, effect, effectCtx);
    return [];
  }

  const targets = resolveTargets(ctx, effect.target, effectCtx);

  for (const target of targets) {
    // A corpse can still anchor a summon, but nothing else lands on it.
    if (!target.alive && effect.kind !== 'summon') continue;

    switch (effect.kind) {
      case 'damage': {
        const scaled =
          effect.amount +
          (effect.scaleWithAtk !== null && source !== null
            ? effectiveStat(source, 'atk') * effect.scaleWithAtk
            : 0);
        dealDamage(
          ctx,
          target,
          {
            amount: outgoingDamage(source, scaled),
            damageType: effect.damageType,
            source: 'ability',
          },
          effectCtx.sourceId,
        );
        break;
      }

      case 'heal': {
        const amount =
          effect.amount +
          (effect.scaleWithMaxHp !== null ? target.maxHp * effect.scaleWithMaxHp : 0);
        heal(ctx, target, amount, effectCtx.sourceId);
        break;
      }

      case 'shield': {
        const amount =
          effect.amount +
          (effect.scaleWithMaxHp !== null ? target.maxHp * effect.scaleWithMaxHp : 0);
        addShield(ctx, target, amount, effect.durationMs, effectCtx.sourceId);
        break;
      }

      case 'statMod': {
        addMod(target, {
          stat: effect.stat,
          op: effect.op,
          amount: effect.amount,
          remainingMs: effect.durationMs,
        });
        emit(ctx, {
          kind: 'statMod',
          sourceId: effectCtx.sourceId,
          targetId: target.instanceId,
          stat: effect.stat,
          op: effect.op,
          amount: effect.amount,
          durationMs: effect.durationMs,
          hpAfter: target.hp,
          maxHpAfter: target.maxHp,
        });
        break;
      }

      case 'status': {
        target.statuses.push({
          status: effect.status,
          magnitude: effect.magnitude,
          remainingMs: effect.durationMs,
          sourceId: effectCtx.sourceId,
        });
        emit(ctx, {
          kind: 'status',
          sourceId: effectCtx.sourceId,
          targetId: target.instanceId,
          status: effect.status,
          durationMs: effect.durationMs,
          magnitude: effect.magnitude,
        });
        break;
      }

      case 'summon':
        summonNear(ctx, effect.unitId, effect.count, target);
        break;
    }
  }

  return targets;
}

/** Applies a list of effects, returning every unit any of them touched. */
export function applyEffects(
  ctx: BattleContext,
  effects: readonly Effect[],
  effectCtx: EffectContext,
): BattleUnit[] {
  const touched: BattleUnit[] = [];
  for (const effect of effects) {
    for (const target of applyEffect(ctx, effect, effectCtx)) {
      if (!touched.includes(target)) touched.push(target);
    }
  }
  return touched;
}

/**
 * Places summons on the free cells nearest an anchor.
 *
 * The board holds twenty units, so occupancy is the natural cap — a summon
 * with nowhere to stand simply does not appear.
 */
function summonNear(
  ctx: BattleContext,
  defId: string,
  count: number,
  anchor: BattleUnit,
): void {
  for (let i = 0; i < count; i += 1) {
    const cell = freeCellsNear(ctx.units, anchor)[0];
    if (cell === undefined) return;
    spawnUnit(ctx, defId, anchor.team, cell.col, cell.row, true);
  }
}

/**
 * Registers a repeating effect.
 *
 * Nested `periodic` children are not registered recursively — see
 * {@link ActivePeriodic}. The first fire happens one full period from now,
 * not immediately.
 */
function registerPeriodic(
  ctx: BattleContext,
  effect: Extract<Effect, { kind: 'periodic' }>,
  effectCtx: EffectContext,
): void {
  const source = unitById(ctx, effectCtx.sourceId);
  if (source === null) return;
  ctx.periodics.push({
    ownerId: source.instanceId,
    team: source.team,
    periodMs: effect.periodMs,
    elapsedMs: 0,
    effects: effect.effects.filter((child) => child.kind !== 'periodic'),
  });
}

/**
 * Registers a team-wide repeating effect with no single owner.
 *
 * Used by synergies: the Undead regeneration aura must keep running when the
 * unit that happened to anchor it dies, unlike an ability's periodic which
 * stops with its owner.
 */
export function registerTeamPeriodic(
  ctx: BattleContext,
  effect: Extract<Effect, { kind: 'periodic' }>,
  team: Team,
): void {
  ctx.periodics.push({
    ownerId: null,
    team,
    periodMs: effect.periodMs,
    elapsedMs: 0,
    effects: effect.effects.filter((child) => child.kind !== 'periodic'),
  });
}

/**
 * Resolves the unit an effect should be attributed to.
 *
 * A unit-owned periodic uses its owner and expires with it. A team-wide aura
 * re-anchors to the lowest-id survivor each time it fires, because effects
 * need *some* source to resolve `alliesWithTag` against — and every selector a
 * synergy uses is team-relative, so which survivor it is changes nothing.
 */
function periodicAnchor(
  ctx: BattleContext,
  periodic: ActivePeriodic,
): BattleUnit | null {
  if (periodic.ownerId !== null) {
    const owner = unitById(ctx, periodic.ownerId);
    return owner !== null && owner.alive ? owner : null;
  }
  return (
    livingOf(ctx, periodic.team).sort((a, b) => a.instanceId - b.instanceId)[0] ?? null
  );
}

/**
 * Advances every registered periodic and fires the ones that came due.
 *
 * A periodic with no valid anchor is dropped: a dead healer stops healing, and
 * a team aura ends when its team is wiped out.
 */
export function tickPeriodics(ctx: BattleContext, elapsedMs: number): void {
  const survivors: ActivePeriodic[] = [];

  for (const periodic of ctx.periodics) {
    const anchor = periodicAnchor(ctx, periodic);
    if (anchor === null) continue;
    survivors.push(periodic);

    periodic.elapsedMs += elapsedMs;
    if (periodic.elapsedMs < periodic.periodMs) continue;
    periodic.elapsedMs -= periodic.periodMs;

    applyEffects(ctx, periodic.effects, {
      sourceId: anchor.instanceId,
      eventSourceId: null,
      attackTargetId: null,
    });
  }

  ctx.periodics = survivors;
}

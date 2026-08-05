/**
 * The mutable working set used inside a single tick.
 *
 * `stepBattle` is pure from the outside: it deep-copies the incoming state
 * into a `BattleContext`, mutates that freely, and produces a fresh
 * `BattleState`. The input is never touched. Doing it this way keeps the
 * public contract clean without paying for a persistent data structure on
 * every unit, every tick.
 */

import type { GameData } from '../../data/schema';
import type { Rng } from '../rng';
import { createRng } from '../rng';
import type { BattleEvent } from './events';
import type {
  ActiveMod,
  ActivePeriodic,
  ActiveStatus,
  BattleOutcome,
  BattleState,
  BattleUnit,
  EndReason,
  PendingTrigger,
  Team,
} from './types';

export interface BattleContext {
  readonly data: GameData;
  /** Restored from `state.rngState`; its final state is written back. */
  readonly rng: Rng;
  /** The tick being simulated. Stamped onto every event. */
  readonly tick: number;
  units: BattleUnit[];
  periodics: ActivePeriodic[];
  nextInstanceId: number;
  readonly startingHp: Record<Team, number>;
  readonly events: BattleEvent[];
  /**
   * Triggers raised mid-tick and resolved at the end of it. Deferring them
   * keeps a chain of reactions (a death ability killing another unit) from
   * recursing through the middle of another unit's turn.
   */
  readonly pendingTriggers: PendingTrigger[];
}

/** Distributes `Omit` across a union so each member keeps its own shape. */
type WithoutTick<T> = T extends unknown ? Omit<T, 'tick'> : never;

/** Records an event, stamping it with the current tick. */
export function emit(ctx: BattleContext, event: WithoutTick<BattleEvent>): void {
  // The spread reassembles a complete member of the union; TypeScript cannot
  // verify that across a distributed Omit, so the shape is asserted here.
  ctx.events.push({ ...event, tick: ctx.tick } as BattleEvent);
}

/**
 * Looks a unit up by id.
 *
 * Instance ids are handed out in push order and units are never removed from
 * the list — a dead unit stays put with `alive: false` — so `units[id]` is the
 * unit with that id. The identity check keeps this correct even if that
 * invariant is ever broken, at which point it falls back to a scan.
 */
export function unitById(ctx: BattleContext, id: number | null): BattleUnit | null {
  if (id === null) return null;
  const direct = ctx.units[id];
  if (direct !== undefined && direct.instanceId === id) return direct;
  return ctx.units.find((unit) => unit.instanceId === id) ?? null;
}

/** A living unit, or `null` if the id is unknown or the unit is dead. */
export function livingById(ctx: BattleContext, id: number | null): BattleUnit | null {
  const unit = unitById(ctx, id);
  return unit !== null && unit.alive ? unit : null;
}

export function living(ctx: BattleContext): BattleUnit[] {
  return ctx.units.filter((unit) => unit.alive);
}

export function livingOf(ctx: BattleContext, team: Team): BattleUnit[] {
  return ctx.units.filter((unit) => unit.alive && unit.team === team);
}

/** Counts survivors without allocating. Called every tick by the end check. */
export function countLivingOf(ctx: BattleContext, team: Team): number {
  let count = 0;
  for (const unit of ctx.units) {
    if (unit.alive && unit.team === team) count += 1;
  }
  return count;
}

function cloneMod(mod: ActiveMod): ActiveMod {
  return { stat: mod.stat, op: mod.op, amount: mod.amount, remainingMs: mod.remainingMs };
}

function cloneStatus(status: ActiveStatus): ActiveStatus {
  return {
    status: status.status,
    magnitude: status.magnitude,
    remainingMs: status.remainingMs,
    sourceId: status.sourceId,
  };
}

/** Deep copy. Written out rather than using `structuredClone` so core keeps no
 *  dependency on a host global, and so the cost is visible. */
export function cloneUnit(unit: BattleUnit): BattleUnit {
  return {
    instanceId: unit.instanceId,
    defId: unit.defId,
    team: unit.team,
    tags: unit.tags,
    abilityId: unit.abilityId,
    summoned: unit.summoned,
    col: unit.col,
    row: unit.row,
    hp: unit.hp,
    maxHp: unit.maxHp,
    shields: unit.shields.map((entry) => ({ ...entry })),
    alive: unit.alive,
    baseStats: unit.baseStats,
    mods: unit.mods.map(cloneMod),
    statuses: unit.statuses.map(cloneStatus),
    attackCooldownMs: unit.attackCooldownMs,
    moveCooldownMs: unit.moveCooldownMs,
    abilityElapsedMs: unit.abilityElapsedMs,
    abilityCooldownMs: unit.abilityCooldownMs,
    targetId: unit.targetId,
  };
}

function clonePeriodic(periodic: ActivePeriodic): ActivePeriodic {
  return {
    ownerId: periodic.ownerId,
    team: periodic.team,
    periodMs: periodic.periodMs,
    elapsedMs: periodic.elapsedMs,
    effects: periodic.effects,
  };
}

/**
 * Builds a working context for the tick that follows `state`.
 *
 * `tags` and `baseStats` are shared rather than copied — they are never
 * mutated, and copying them per unit per tick would dominate the cost.
 */
export function createContext(data: GameData, state: BattleState): BattleContext {
  return {
    data,
    rng: createRng(state.rngState),
    tick: state.tick + 1,
    units: state.units.map(cloneUnit),
    periodics: state.periodics.map(clonePeriodic),
    nextInstanceId: state.nextInstanceId,
    startingHp: { ...state.startingHp },
    events: [],
    pendingTriggers: [],
  };
}

/** Freezes a context back into an immutable state. */
export function toState(
  ctx: BattleContext,
  outcome: BattleOutcome | null,
  endReason: EndReason | null,
): BattleState {
  return {
    tick: ctx.tick,
    rngState: ctx.rng.getState(),
    units: ctx.units,
    periodics: ctx.periodics,
    nextInstanceId: ctx.nextInstanceId,
    startingHp: ctx.startingHp,
    outcome,
    endReason,
  };
}

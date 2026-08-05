/**
 * The battle event log.
 *
 * The renderer does not read `BattleState` frame by frame — it *replays this
 * log*. That sets the bar for what each event must carry: enough to redraw the
 * moment without consulting the simulation. A `move` carries both endpoints
 * and the duration to tween over; an `attack` carries both positions so the
 * swing can be drawn without tracking anyone; a `damage` carries the resulting
 * HP so a bar can be set directly rather than accumulated.
 *
 * Events are values, not state: `stepBattle` returns the events produced by
 * that tick rather than appending to a growing array inside the state. That
 * keeps stepping O(units) instead of O(units x ticks).
 */

import type {
  AbilityTrigger,
  DamageType,
  StatKey,
  StatusKind,
  UnitTag,
} from '../../data/schema';
import type { BattleOutcome, DamageSource, EndReason, Team } from './types';

interface EventBase {
  /** Tick on which this happened. Multiplied by `BATTLE.tickMs` for a time. */
  readonly tick: number;
}

/** A unit entered the battle — at the start, or via `summon`. */
export interface SpawnEvent extends EventBase {
  readonly kind: 'spawn';
  readonly instanceId: number;
  readonly defId: string;
  readonly team: Team;
  readonly col: number;
  readonly row: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly summoned: boolean;
}

/** A unit stepped to an adjacent cell. */
export interface MoveEvent extends EventBase {
  readonly kind: 'move';
  readonly instanceId: number;
  readonly fromCol: number;
  readonly fromRow: number;
  readonly toCol: number;
  readonly toRow: number;
  /** How long the step takes, so the renderer can tween it at any frame rate. */
  readonly durationMs: number;
}

/** A unit's attack cooldown came up and it swung. Damage is a separate event. */
export interface AttackEvent extends EventBase {
  readonly kind: 'attack';
  readonly instanceId: number;
  readonly targetId: number;
  readonly col: number;
  readonly row: number;
  readonly targetCol: number;
  readonly targetRow: number;
}

export interface DamageEvent extends EventBase {
  readonly kind: 'damage';
  readonly sourceId: number | null;
  readonly targetId: number;
  /** Damage actually applied, after shields and mitigation. */
  readonly amount: number;
  /** Portion swallowed by the shield rather than HP. */
  readonly absorbed: number;
  readonly damageType: DamageType;
  readonly source: DamageSource;
  readonly hpAfter: number;
  readonly shieldAfter: number;
  readonly lethal: boolean;
}

export interface HealEvent extends EventBase {
  readonly kind: 'heal';
  readonly sourceId: number | null;
  readonly targetId: number;
  /** Healing actually applied, after the max-HP cap. */
  readonly amount: number;
  readonly hpAfter: number;
}

export interface ShieldEvent extends EventBase {
  readonly kind: 'shield';
  readonly sourceId: number | null;
  readonly targetId: number;
  readonly amount: number;
  readonly shieldAfter: number;
}

export interface StatModEvent extends EventBase {
  readonly kind: 'statMod';
  readonly sourceId: number | null;
  readonly targetId: number;
  readonly stat: StatKey;
  readonly op: 'add' | 'mult';
  readonly amount: number;
  readonly durationMs: number | null;
  /** Resulting values, so an `hp` modifier is replayable from the log alone —
   *  gaining max HP grants the difference, which the renderer cannot infer. */
  readonly hpAfter: number;
  readonly maxHpAfter: number;
}

export interface StatusEvent extends EventBase {
  readonly kind: 'status';
  readonly sourceId: number | null;
  readonly targetId: number;
  readonly status: StatusKind;
  readonly durationMs: number;
  readonly magnitude: number;
}

/** An ability fired. The effects it produced follow as their own events. */
export interface AbilityEvent extends EventBase {
  readonly kind: 'ability';
  readonly instanceId: number;
  readonly abilityId: string;
  readonly trigger: AbilityTrigger;
  readonly targetIds: readonly number[];
}

export interface DeathEvent extends EventBase {
  readonly kind: 'death';
  readonly instanceId: number;
  readonly killerId: number | null;
}

/** A synergy threshold was met and applied. Emitted once, at battle start. */
export interface SynergyAppliedEvent extends EventBase {
  readonly kind: 'synergyApplied';
  readonly team: Team;
  readonly synergyId: string;
  readonly tag: UnitTag;
  /** How many distinct units carried the tag. */
  readonly unitCount: number;
  /** The threshold that was satisfied. */
  readonly thresholdCount: number;
  readonly description: string;
  readonly affectedIds: readonly number[];
}

export interface BattleStartEvent extends EventBase {
  readonly kind: 'battleStart';
  readonly seed: number;
}

export interface BattleEndEvent extends EventBase {
  readonly kind: 'battleEnd';
  readonly outcome: BattleOutcome;
  readonly reason: EndReason;
  readonly playerAlive: number;
  readonly enemyAlive: number;
}

export type BattleEvent =
  | SpawnEvent
  | MoveEvent
  | AttackEvent
  | DamageEvent
  | HealEvent
  | ShieldEvent
  | StatModEvent
  | StatusEvent
  | AbilityEvent
  | DeathEvent
  | SynergyAppliedEvent
  | BattleStartEvent
  | BattleEndEvent;

export type BattleEventKind = BattleEvent['kind'];

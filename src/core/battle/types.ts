/**
 * Battle state types.
 *
 * Everything here is plain serializable data: no class instances, no closures,
 * no `Map` keys that are not strings or numbers. A `BattleState` can be
 * `JSON.parse(JSON.stringify(state))`-ed and resumed, which is what makes
 * replay and save/load possible.
 *
 * Note what is *absent*: there are no pixel coordinates, no interpolation
 * progress, no animation phases. A unit is on a cell or it is not. Smoothing
 * the visual transition between cells is the renderer's job, and the `move`
 * event carries the duration it needs to do that.
 */

import type {
  DamageType,
  Effect,
  StatKey,
  StatusKind,
  UnitStats,
  UnitTag,
} from '../../data/schema';

export const TEAMS = ['player', 'enemy'] as const;
export type Team = (typeof TEAMS)[number];

/** Returns the opposing team. */
export function opposing(team: Team): Team {
  return team === 'player' ? 'enemy' : 'player';
}

/** A board cell. Integer coordinates only — units are never between cells. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** An active stat modifier. `remainingMs === null` lasts the whole battle. */
export interface ActiveMod {
  readonly stat: StatKey;
  readonly op: 'add' | 'mult';
  readonly amount: number;
  remainingMs: number | null;
}

/**
 * One pooled shield. `remainingMs === null` lasts until broken or the battle
 * ends; a timed one expires like any other modifier.
 */
export interface ShieldEntry {
  amount: number;
  remainingMs: number | null;
}

/** An active status. Duplicates of the same kind stack. */
export interface ActiveStatus {
  readonly status: StatusKind;
  readonly magnitude: number;
  remainingMs: number;
  /** Who applied it, for damage attribution on damage-over-time. */
  readonly sourceId: number | null;
}

/**
 * A unit as it exists during a battle.
 *
 * `baseStats` is a copy of the definition's stats, so the definition is never
 * mutated and a unit can be modified without touching content.
 */
export interface BattleUnit {
  /** Unique within a battle, assigned in spawn order. Also the tie-breaker
   *  for every ordering decision, which is what keeps ticks deterministic. */
  readonly instanceId: number;
  readonly defId: string;
  readonly team: Team;
  readonly tags: readonly UnitTag[];
  readonly abilityId: string | null;
  /** `true` for units created mid-battle by a `summon` effect. */
  readonly summoned: boolean;

  col: number;
  row: number;

  hp: number;
  maxHp: number;
  /** Absorption pool. Read the total with `totalShield`. */
  shields: ShieldEntry[];
  alive: boolean;

  readonly baseStats: UnitStats;
  mods: ActiveMod[];
  statuses: ActiveStatus[];

  /** Milliseconds until this unit may attack again. */
  attackCooldownMs: number;
  /** Milliseconds until this unit may step to the next cell. */
  moveCooldownMs: number;
  /** Milliseconds accumulated toward an `interval` ability's next proc. */
  abilityElapsedMs: number;
  /** Milliseconds until the ability may proc again, from its `cooldownMs`. */
  abilityCooldownMs: number;

  /** Current target's `instanceId`, or `null` if none is acquired. */
  targetId: number | null;
}

/**
 * A repeating effect registered by a `periodic` effect.
 *
 * The child effects are stored inline. They are plain JSON data, so this stays
 * serializable, and it avoids having to encode a path back into `GameData`.
 *
 * Limitation: a `periodic` nested inside another `periodic` is not registered
 * recursively. No content needs it, and it would let one effect schedule
 * unbounded work.
 */
export interface ActivePeriodic {
  /** Owning unit, or `null` for a team-wide synergy aura. */
  readonly ownerId: number | null;
  readonly team: Team;
  readonly periodMs: number;
  elapsedMs: number;
  readonly effects: readonly Effect[];
}

export const BATTLE_OUTCOMES = ['player', 'enemy', 'draw'] as const;
/** Which side won, or `draw`. */
export type BattleOutcome = (typeof BATTLE_OUTCOMES)[number];

export const END_REASONS = ['wipe', 'mutualWipe', 'timeout'] as const;
export type EndReason = (typeof END_REASONS)[number];

export interface BattleState {
  readonly tick: number;
  /**
   * The seeded RNG's state, carried as a plain number so the whole battle
   * stays serializable. `createRng(rngState)` restores the exact stream —
   * mulberry32's state *is* its seed.
   */
  readonly rngState: number;
  readonly units: readonly BattleUnit[];
  readonly periodics: readonly ActivePeriodic[];
  readonly nextInstanceId: number;
  /**
   * The player's relics, in the order they were collected.
   *
   * Ids rather than definitions, so the state stays JSON-serializable, and an
   * array rather than a set so hook order is fixed — two relics that both fire
   * on the same trigger must resolve the same way on every replay.
   */
  readonly relicIds: readonly string[];
  /** Total starting max HP per team, used by the timeout rule. */
  readonly startingHp: Readonly<Record<Team, number>>;
  /** `null` while the battle is still running. */
  readonly outcome: BattleOutcome | null;
  readonly endReason: EndReason | null;
}

/**
 * What an effect knows about the moment it was triggered.
 *
 * Units are referenced by id rather than held directly, so a context created
 * earlier in a tick cannot resurrect a unit that has since died.
 */
export interface EffectContext {
  /** The unit whose ability, synergy or attack produced this effect. */
  readonly sourceId: number;
  /** Whoever caused the trigger: the attacker on `onHit`, the fallen ally on
   *  `onAllyDeath`. `null` on triggers with no such unit. */
  readonly eventSourceId: number | null;
  /** The unit currently under attack, on attack-driven triggers. */
  readonly attackTargetId: number | null;
}

/** A trigger raised during a tick and resolved at the end of it. */
export type PendingTrigger =
  | { readonly kind: 'onSpawn'; readonly unitId: number }
  | { readonly kind: 'onHit'; readonly unitId: number; readonly sourceId: number | null }
  | {
      readonly kind: 'onDeath';
      readonly unitId: number;
      readonly killerId: number | null;
    }
  | {
      readonly kind: 'onAllyDeath';
      readonly unitId: number;
      readonly deadAllyId: number;
    };

/** Where a point of damage came from, for the event log. */
export const DAMAGE_SOURCES = ['attack', 'ability', 'status', 'synergy'] as const;
export type DamageSource = (typeof DAMAGE_SOURCES)[number];

export interface DamageInput {
  readonly amount: number;
  readonly damageType: DamageType;
  readonly source: DamageSource;
}

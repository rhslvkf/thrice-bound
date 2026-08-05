/**
 * Content schema for THRICEBOUND.
 *
 * These types describe the shape of the JSON files in this folder. They are
 * data-only: no behaviour, no methods, nothing that cannot survive a JSON
 * round-trip. `src/core` consumes them, `src/sim` loads the same files under
 * Node, and the loader in `./loader.ts` is the only thing that turns raw JSON
 * into these types.
 *
 * Design note on abilities and synergies: effects are expressed as a list of
 * composable {@link Effect} objects rather than as identifiers that core would
 * resolve through a hardcoded `switch`. Adding a new ability should be a data
 * edit; only genuinely new *kinds* of effect require core changes.
 *
 * Optionality is expressed as `| null`, never as an optional property, so that
 * every field is present in JSON and the validator can report a missing key as
 * an error instead of silently accepting it.
 */

/** Board geometry. Player deploys on the bottom rows, enemies on the top. */
export const BOARD = {
  cols: 5,
  rows: 4,
  enemyRows: [0, 1],
  playerRows: [2, 3],
} as const;

/** Identical copies required on the board to perform a merge. */
export const MERGE_COST_IN_COPIES = 3;

/** Lowest and highest unit tier. Tier 3 is terminal — it cannot be merged. */
export const MIN_TIER = 1;
export const MAX_TIER = 3;

/** How many upgrade targets a mergeable unit must offer. The choice between
 *  them is the central decision of the game, so "at least two" is a schema
 *  rule, not a convention. */
export const MIN_MERGE_OPTIONS = 2;

/**
 * Placeholder art identifier. No images exist yet; `artKey` is a stable
 * logical name (`unit/thornling`) that the atlas pipeline in `tools/` will
 * later resolve to a real texture. Until then the renderer substitutes a
 * generated placeholder, so an unresolved key must never be fatal.
 */
export type ArtKey = string;

export const UNIT_TAGS = ['Beast', 'Undead', 'Arcane', 'Steel'] as const;
export type UnitTag = (typeof UNIT_TAGS)[number];

export const STAT_KEYS = ['hp', 'atk', 'atkSpeed', 'range', 'moveSpeed'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const DAMAGE_TYPES = ['physical', 'magical', 'pure'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const STATUS_KINDS = [
  'burn',
  'poison',
  'chill',
  'stun',
  'weaken',
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/** Base combat stats. Tuning lives here; core reads, never hardcodes. */
export interface UnitStats {
  /** Maximum hit points. */
  readonly hp: number;
  /** Damage per attack, before damage type and modifiers. */
  readonly atk: number;
  /** Attacks per second. */
  readonly atkSpeed: number;
  /** Attack reach in board tiles. `1` is melee/adjacent. */
  readonly range: number;
  /** Movement in board tiles per second. */
  readonly moveSpeed: number;
}

// ---------------------------------------------------------------------------
// Effects — the composable vocabulary shared by abilities, synergies and relics
// ---------------------------------------------------------------------------

export const TARGET_MODES = [
  /** The unit that owns the ability. */
  'self',
  /** Whatever caused the trigger — the attacker on `onHit`, the dying ally on
   *  `onAllyDeath`. Invalid on triggers with no source, e.g. `onSpawn`. */
  'eventSource',
  /** The unit currently being attacked. */
  'attackTarget',
  'nearestEnemy',
  'randomEnemy',
  'lowestHpAlly',
  'allEnemies',
  'allAllies',
  'enemiesInRadius',
  'alliesInRadius',
  'alliesWithTag',
] as const;
export type TargetMode = (typeof TARGET_MODES)[number];

/**
 * Who an effect lands on. `count` and `radius` and `tag` are only meaningful
 * for the modes that declare them; the loader rejects the combinations that
 * do not make sense rather than silently ignoring a stray field.
 */
export interface TargetSelector {
  readonly mode: TargetMode;
  /** Number of units picked, for the modes that select a bounded set. */
  readonly count: number | null;
  /** Radius in board tiles, for the radius modes. */
  readonly radius: number | null;
  /** Tag filter, for `alliesWithTag`. */
  readonly tag: UnitTag | null;
}

export const EFFECT_KINDS = [
  'damage',
  'heal',
  'shield',
  'statMod',
  'status',
  'summon',
  'periodic',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface DamageEffect {
  readonly kind: 'damage';
  readonly target: TargetSelector;
  /** Flat damage before scaling. */
  readonly amount: number;
  readonly damageType: DamageType;
  /** Added on top of `amount` as a multiple of the source unit's `atk`. */
  readonly scaleWithAtk: number | null;
}

export interface HealEffect {
  readonly kind: 'heal';
  readonly target: TargetSelector;
  readonly amount: number;
  /** Added on top of `amount` as a fraction of the target's max HP. */
  readonly scaleWithMaxHp: number | null;
}

export interface ShieldEffect {
  readonly kind: 'shield';
  readonly target: TargetSelector;
  readonly amount: number;
  readonly scaleWithMaxHp: number | null;
  /** `null` means the shield lasts until it is broken or the battle ends. */
  readonly durationMs: number | null;
}

export interface StatModEffect {
  readonly kind: 'statMod';
  readonly target: TargetSelector;
  readonly stat: StatKey;
  /** `add` sums into the stat; `mult` scales it (`0.15` = +15%). */
  readonly op: 'add' | 'mult';
  readonly amount: number;
  /** `null` means it lasts for the rest of the battle. */
  readonly durationMs: number | null;
}

export interface StatusEffect {
  readonly kind: 'status';
  readonly target: TargetSelector;
  readonly status: StatusKind;
  readonly durationMs: number;
  /** Meaning depends on the status: damage per second for `burn`, slow
   *  fraction for `chill`, and so on. Ignored by `stun`. */
  readonly magnitude: number;
}

export interface SummonEffect {
  readonly kind: 'summon';
  readonly target: TargetSelector;
  /** Must reference a unit in `units.json`; the loader verifies it. */
  readonly unitId: string;
  readonly count: number;
}

/**
 * Repeats its children on a fixed period for as long as the source is alive.
 * Recursive by design — this is what expresses regeneration and damage-over-
 * time auras without a dedicated effect kind per case.
 */
export interface PeriodicEffect {
  readonly kind: 'periodic';
  readonly periodMs: number;
  readonly effects: readonly Effect[];
}

export type Effect =
  | DamageEffect
  | HealEffect
  | ShieldEffect
  | StatModEffect
  | StatusEffect
  | SummonEffect
  | PeriodicEffect;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface UnitDef {
  /** Stable content id, e.g. `unit.thornling`. Referenced by saves. */
  readonly id: string;
  readonly name: string;
  /** 1..3. Tier 3 is terminal. */
  readonly tier: number;
  /** Drives synergy counting. At least one. */
  readonly tags: readonly UnitTag[];
  /** Shop price in gold. Only tier 1 units appear in the shop; on higher tiers
   *  this is the nominal value used for sell-back. */
  readonly cost: number;
  readonly stats: UnitStats;
  /** `null` for units with no special behaviour. */
  readonly abilityId: string | null;
  /**
   * Upgrade candidates offered when three copies of this unit are merged.
   * The player picks one — this array *is* the merge-direction choice, and is
   * why it is a list rather than a single id. Empty only at tier 3.
   */
  readonly mergesInto: readonly string[];
  readonly artKey: ArtKey;
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export const ABILITY_TRIGGERS = [
  'onSpawn',
  'onAttack',
  'onHit',
  'onDeath',
  'interval',
  'onAllyDeath',
] as const;
export type AbilityTrigger = (typeof ABILITY_TRIGGERS)[number];

export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  /** Player-facing text. Kept in data so it can be localized later. */
  readonly description: string;
  readonly trigger: AbilityTrigger;
  /** Required when `trigger` is `interval`, and must be `null` otherwise. */
  readonly intervalMs: number | null;
  /** Minimum gap between procs. `null` means no cooldown. */
  readonly cooldownMs: number | null;
  /** Proc probability in `[0, 1]`. Rolled against the injected seeded RNG. */
  readonly chance: number;
  readonly effects: readonly Effect[];
  readonly artKey: ArtKey;
}

// ---------------------------------------------------------------------------
// Synergies
// ---------------------------------------------------------------------------

export interface SynergyThreshold {
  /** Number of distinct deployed units carrying the tag. */
  readonly count: number;
  readonly description: string;
  readonly effects: readonly Effect[];
}

export interface SynergyDef {
  readonly id: string;
  readonly name: string;
  readonly tag: UnitTag;
  readonly description: string;
  /** Ordered ascending by `count`; only the highest satisfied tier applies. */
  readonly thresholds: readonly SynergyThreshold[];
  readonly artKey: ArtKey;
}

// ---------------------------------------------------------------------------
// Relics
// ---------------------------------------------------------------------------

export const RELIC_RARITIES = ['common', 'rare', 'legendary'] as const;
export type RelicRarity = (typeof RELIC_RARITIES)[number];

export const RELIC_TRIGGERS = [
  'onRunStart',
  'onRoundStart',
  'onRoundEnd',
  'onBattleStart',
  'onBattleEnd',
  'onMerge',
  'onShopReroll',
  'onUnitPurchase',
  'onUnitDeath',
] as const;
export type RelicTrigger = (typeof RELIC_TRIGGERS)[number];

export const RELIC_CONDITION_KINDS = [
  'always',
  'roundAtLeast',
  'tagCountAtLeast',
  'goldAtMost',
] as const;
export type RelicConditionKind = (typeof RELIC_CONDITION_KINDS)[number];

export interface RelicCondition {
  readonly kind: RelicConditionKind;
  /** Threshold value; meaning depends on `kind`. `null` for `always`. */
  readonly value: number | null;
  /** Only used by `tagCountAtLeast`. */
  readonly tag: UnitTag | null;
}

export const RELIC_ACTION_KINDS = [
  'grantGold',
  'grantReroll',
  'grantUnit',
  'shopOdds',
  'applyEffect',
] as const;
export type RelicActionKind = (typeof RELIC_ACTION_KINDS)[number];

export interface GrantGoldAction {
  readonly kind: 'grantGold';
  readonly amount: number;
}

export interface GrantRerollAction {
  readonly kind: 'grantReroll';
  readonly amount: number;
}

export interface GrantUnitAction {
  readonly kind: 'grantUnit';
  /** Must reference a unit in `units.json`; the loader verifies it. */
  readonly unitId: string;
  readonly count: number;
}

export interface ShopOddsAction {
  readonly kind: 'shopOdds';
  /** `null` applies the multiplier to every shop entry. */
  readonly tag: UnitTag | null;
  readonly weightMult: number;
}

/** Bridges relics into the combat effect vocabulary. */
export interface ApplyEffectAction {
  readonly kind: 'applyEffect';
  readonly effect: Effect;
}

export type RelicAction =
  | GrantGoldAction
  | GrantRerollAction
  | GrantUnitAction
  | ShopOddsAction
  | ApplyEffectAction;

export interface RelicHook {
  readonly on: RelicTrigger;
  readonly condition: RelicCondition;
  readonly actions: readonly RelicAction[];
}

export interface RelicDef {
  readonly id: string;
  readonly name: string;
  readonly rarity: RelicRarity;
  readonly description: string;
  readonly hooks: readonly RelicHook[];
  readonly artKey: ArtKey;
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

export interface EnemyPlacement {
  /** Must reference a unit in `units.json`; the loader verifies it. */
  readonly unitId: string;
  /** Column, `0 .. BOARD.cols - 1`. */
  readonly col: number;
  /** Row, restricted to `BOARD.enemyRows`. */
  readonly row: number;
}

export interface EncounterDef {
  readonly id: string;
  /** 1-based round number this encounter belongs to. */
  readonly round: number;
  readonly name: string;
  readonly placements: readonly EnemyPlacement[];
  readonly goldReward: number;
  readonly artKey: ArtKey;
}

// ---------------------------------------------------------------------------
// Loaded content
// ---------------------------------------------------------------------------

/** Everything in this folder, validated and indexed by id. */
export interface GameData {
  readonly version: number;
  readonly units: ReadonlyMap<string, UnitDef>;
  readonly abilities: ReadonlyMap<string, AbilityDef>;
  readonly synergies: ReadonlyMap<string, SynergyDef>;
  readonly relics: ReadonlyMap<string, RelicDef>;
  /** Ordered ascending by `round`. */
  readonly encounters: readonly EncounterDef[];
}

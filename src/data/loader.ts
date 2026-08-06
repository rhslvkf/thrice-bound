/**
 * Turns raw JSON into validated {@link GameData}.
 *
 * Two phases, deliberately separated:
 *
 * 1. **Shape validation** — each definition is checked field by field, with
 *    unknown keys rejected. Failures are batched so one load reports every
 *    broken entry.
 * 2. **Cross-reference validation** — ids actually resolve, merge targets go
 *    strictly upward in tier, tier 3 is terminal, no cycles. This phase can
 *    only run once everything is indexed.
 *
 * Node and the browser both take this path: the JSON is imported statically,
 * so the headless simulator validates exactly the content the game ships.
 */

import abilitiesJson from './abilities.json';
import encountersJson from './encounters.json';
import relicsJson from './relics.json';
import runJson from './run.json';
import synergiesJson from './synergies.json';
import unitsJson from './units.json';

import {
  ABILITY_TRIGGERS,
  BATTLE_RELIC_TRIGGERS,
  BOARD,
  DAMAGE_TYPES,
  MAX_TIER,
  MIN_MERGE_OPTIONS,
  MIN_TIER,
  RELIC_ACTION_KINDS,
  RELIC_CONDITION_KINDS,
  RELIC_RARITIES,
  RELIC_TRIGGERS,
  STAT_KEYS,
  STATUS_KINDS,
  TARGET_MODES,
  UNIT_TAGS,
  type AbilityDef,
  type Effect,
  type EncounterDef,
  type EnemyPlacement,
  type GameData,
  type RelicAction,
  type RarityWeight,
  type RelicCondition,
  type RelicDef,
  type RelicHook,
  type RunConfig,
  type RunRules,
  type ShopTierOdds,
  type SynergyDef,
  type SynergyThreshold,
  type TargetSelector,
  type UnitDef,
  type UnitStats,
  type UnitTag,
} from './schema';
import {
  asArray,
  asBoolean,
  asEnum,
  asNullOr,
  asNumber,
  asObject,
  asString,
  DataValidationError,
  exactKeys,
  FieldError,
  IssueCollector,
  indexById,
  validateEach,
} from './validate';

/**
 * Rejects a single field. Throwing {@link FieldError} rather than a bare
 * error is what lets {@link validateEach} batch problems: one bad unit does
 * not hide the other eleven.
 */
function fail(path: string, reason: string): never {
  throw new FieldError(path, reason);
}

/** Guards against a malformed file nesting `periodic` effects indefinitely. */
const MAX_EFFECT_DEPTH = 3;

/** Probabilities and fractions are validated against this range. */
const UNIT_INTERVAL = { min: 0, max: 1 } as const;

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Target modes that require `count`, `radius` or `tag` respectively. */
const MODES_REQUIRING_COUNT = ['nearestEnemy', 'randomEnemy', 'lowestHpAlly'];
const MODES_REQUIRING_RADIUS = ['enemiesInRadius', 'alliesInRadius'];
const MODES_REQUIRING_TAG = ['alliesWithTag'];

function parseTargetSelector(raw: unknown, path: string): TargetSelector {
  const object = asObject(raw, path);
  exactKeys(object, path, ['mode', 'count', 'radius', 'tag']);

  const mode = asEnum(object['mode'], `${path}.mode`, TARGET_MODES);
  const count = asNullOr(object['count'], `${path}.count`, (v, p) =>
    asNumber(v, p, { integer: true, min: 1 }),
  );
  const radius = asNullOr(object['radius'], `${path}.radius`, (v, p) =>
    asNumber(v, p, { min: 0, exclusiveMin: true }),
  );
  const tag = asNullOr(object['tag'], `${path}.tag`, (v, p) =>
    asEnum(v, p, UNIT_TAGS),
  );

  // A selector that carries the wrong qualifier is almost always a content
  // mistake, so reject rather than ignore.
  requireQualifier(MODES_REQUIRING_COUNT, mode, count, `${path}.count`, 'count');
  requireQualifier(MODES_REQUIRING_RADIUS, mode, radius, `${path}.radius`, 'radius');
  requireQualifier(MODES_REQUIRING_TAG, mode, tag, `${path}.tag`, 'tag');

  return { mode, count, radius, tag };
}

function requireQualifier(
  modesRequiring: readonly string[],
  mode: string,
  value: unknown,
  path: string,
  label: string,
): void {
  const required = modesRequiring.includes(mode);
  if (required && value === null) {
    fail(path, `target mode ${JSON.stringify(mode)} requires a ${label}, got null`);
  }
  if (!required && value !== null) {
    fail(path, `target mode ${JSON.stringify(mode)} does not use ${label}, expected null`);
  }
}

function parseEffect(raw: unknown, path: string, depth = 0): Effect {
  if (depth > MAX_EFFECT_DEPTH) {
    fail(path, `effect nesting exceeds the maximum depth of ${MAX_EFFECT_DEPTH}`);
  }
  const object = asObject(raw, path);
  const kind = asString(object['kind'], `${path}.kind`);

  switch (kind) {
    case 'damage': {
      exactKeys(object, path, ['kind', 'target', 'amount', 'damageType', 'scaleWithAtk']);
      return {
        kind: 'damage',
        target: parseTargetSelector(object['target'], `${path}.target`),
        amount: asNumber(object['amount'], `${path}.amount`, { min: 0 }),
        damageType: asEnum(object['damageType'], `${path}.damageType`, DAMAGE_TYPES),
        scaleWithAtk: asNullOr(object['scaleWithAtk'], `${path}.scaleWithAtk`, (v, p) =>
          asNumber(v, p, { min: 0 }),
        ),
      };
    }
    case 'heal': {
      exactKeys(object, path, ['kind', 'target', 'amount', 'scaleWithMaxHp']);
      return {
        kind: 'heal',
        target: parseTargetSelector(object['target'], `${path}.target`),
        amount: asNumber(object['amount'], `${path}.amount`, { min: 0 }),
        scaleWithMaxHp: asNullOr(
          object['scaleWithMaxHp'],
          `${path}.scaleWithMaxHp`,
          (v, p) => asNumber(v, p, UNIT_INTERVAL),
        ),
      };
    }
    case 'shield': {
      exactKeys(object, path, [
        'kind',
        'target',
        'amount',
        'scaleWithMaxHp',
        'durationMs',
      ]);
      return {
        kind: 'shield',
        target: parseTargetSelector(object['target'], `${path}.target`),
        amount: asNumber(object['amount'], `${path}.amount`, { min: 0 }),
        scaleWithMaxHp: asNullOr(
          object['scaleWithMaxHp'],
          `${path}.scaleWithMaxHp`,
          (v, p) => asNumber(v, p, UNIT_INTERVAL),
        ),
        durationMs: asNullOr(object['durationMs'], `${path}.durationMs`, (v, p) =>
          asNumber(v, p, { integer: true, min: 0, exclusiveMin: true }),
        ),
      };
    }
    case 'statMod': {
      exactKeys(object, path, ['kind', 'target', 'stat', 'op', 'amount', 'durationMs']);
      return {
        kind: 'statMod',
        target: parseTargetSelector(object['target'], `${path}.target`),
        stat: asEnum(object['stat'], `${path}.stat`, STAT_KEYS),
        op: asEnum(object['op'], `${path}.op`, ['add', 'mult'] as const),
        amount: asNumber(object['amount'], `${path}.amount`),
        durationMs: asNullOr(object['durationMs'], `${path}.durationMs`, (v, p) =>
          asNumber(v, p, { integer: true, min: 0, exclusiveMin: true }),
        ),
      };
    }
    case 'status': {
      exactKeys(object, path, ['kind', 'target', 'status', 'durationMs', 'magnitude']);
      return {
        kind: 'status',
        target: parseTargetSelector(object['target'], `${path}.target`),
        status: asEnum(object['status'], `${path}.status`, STATUS_KINDS),
        durationMs: asNumber(object['durationMs'], `${path}.durationMs`, {
          integer: true,
          min: 0,
          exclusiveMin: true,
        }),
        magnitude: asNumber(object['magnitude'], `${path}.magnitude`, { min: 0 }),
      };
    }
    case 'summon': {
      exactKeys(object, path, ['kind', 'target', 'unitId', 'count']);
      return {
        kind: 'summon',
        target: parseTargetSelector(object['target'], `${path}.target`),
        unitId: asString(object['unitId'], `${path}.unitId`),
        count: asNumber(object['count'], `${path}.count`, { integer: true, min: 1 }),
      };
    }
    case 'periodic': {
      exactKeys(object, path, ['kind', 'periodMs', 'effects']);
      const inner = asArray(object['effects'], `${path}.effects`);
      if (inner.length === 0) {
        fail(`${path}.effects`, 'expected at least one effect');
      }
      return {
        kind: 'periodic',
        periodMs: asNumber(object['periodMs'], `${path}.periodMs`, {
          integer: true,
          min: 0,
          exclusiveMin: true,
        }),
        effects: inner.map((child, index) =>
          parseEffect(child, `${path}.effects[${index}]`, depth + 1),
        ),
      };
    }
    default:
      fail(`${path}.kind`, `unknown effect kind ${JSON.stringify(kind)}`);
  }
}

function parseEffects(raw: unknown, path: string): Effect[] {
  const items = asArray(raw, path);
  if (items.length === 0) {
    fail(path, 'expected at least one effect');
  }
  return items.map((item, index) => parseEffect(item, `${path}[${index}]`));
}

/** Walks an effect tree, yielding every node including nested `periodic` children. */
function* walkEffects(effects: readonly Effect[]): Generator<Effect> {
  for (const effect of effects) {
    yield effect;
    if (effect.kind === 'periodic') {
      yield* walkEffects(effect.effects);
    }
  }
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

function parseStats(raw: unknown, path: string): UnitStats {
  const object = asObject(raw, path);
  exactKeys(object, path, [...STAT_KEYS]);
  return {
    hp: asNumber(object['hp'], `${path}.hp`, { min: 0, exclusiveMin: true }),
    atk: asNumber(object['atk'], `${path}.atk`, { min: 0, exclusiveMin: true }),
    atkSpeed: asNumber(object['atkSpeed'], `${path}.atkSpeed`, {
      min: 0,
      exclusiveMin: true,
    }),
    range: asNumber(object['range'], `${path}.range`, {
      integer: true,
      min: 1,
      max: Math.max(BOARD.cols, BOARD.rows),
    }),
    moveSpeed: asNumber(object['moveSpeed'], `${path}.moveSpeed`, { min: 0 }),
  };
}

function parseUnit(raw: unknown, path: string): UnitDef {
  const object = asObject(raw, path);
  exactKeys(object, path, [
    'id',
    'name',
    'tier',
    'tags',
    'cost',
    'stats',
    'abilityId',
    'mergesInto',
    'artKey',
  ]);

  const tier = asNumber(object['tier'], `${path}.tier`, {
    integer: true,
    min: MIN_TIER,
    max: MAX_TIER,
  });

  const rawTags = asArray(object['tags'], `${path}.tags`);
  if (rawTags.length === 0) {
    fail(`${path}.tags`, 'expected at least one tag');
  }
  const tags = rawTags.map((tag, index) =>
    asEnum(tag, `${path}.tags[${index}]`, UNIT_TAGS),
  );
  const duplicateTag = tags.find((tag, index) => tags.indexOf(tag) !== index);
  if (duplicateTag !== undefined) {
    fail(`${path}.tags`, `duplicate tag ${JSON.stringify(duplicateTag)}`);
  }

  const rawMerges = asArray(object['mergesInto'], `${path}.mergesInto`);
  const mergesInto = rawMerges.map((id, index) =>
    asString(id, `${path}.mergesInto[${index}]`),
  );

  // The merge-direction choice is the core mechanic, so its arity is a schema
  // rule: mergeable units must offer a real choice, tier 3 must offer none.
  if (tier === MAX_TIER && mergesInto.length > 0) {
    fail(`${path}.mergesInto`, `tier ${MAX_TIER} units are terminal and must have an empty mergesInto, got ${mergesInto.length} entrie(s)`);
  }
  if (tier < MAX_TIER && mergesInto.length < MIN_MERGE_OPTIONS) {
    fail(`${path}.mergesInto`, `tier ${tier} units must offer at least ${MIN_MERGE_OPTIONS} merge targets, got ${mergesInto.length}`);
  }
  const duplicateMerge = mergesInto.find((id, index) => mergesInto.indexOf(id) !== index);
  if (duplicateMerge !== undefined) {
    fail(`${path}.mergesInto`, `duplicate merge target ${JSON.stringify(duplicateMerge)}`);
  }

  return {
    id: asString(object['id'], `${path}.id`),
    name: asString(object['name'], `${path}.name`),
    tier,
    tags,
    cost: asNumber(object['cost'], `${path}.cost`, { integer: true, min: 0 }),
    stats: parseStats(object['stats'], `${path}.stats`),
    abilityId: asNullOr(object['abilityId'], `${path}.abilityId`, asString),
    mergesInto,
    artKey: asString(object['artKey'], `${path}.artKey`),
  };
}

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

function parseAbility(raw: unknown, path: string): AbilityDef {
  const object = asObject(raw, path);
  exactKeys(object, path, [
    'id',
    'name',
    'description',
    'trigger',
    'intervalMs',
    'cooldownMs',
    'chance',
    'effects',
    'artKey',
  ]);

  const trigger = asEnum(object['trigger'], `${path}.trigger`, ABILITY_TRIGGERS);
  const intervalMs = asNullOr(object['intervalMs'], `${path}.intervalMs`, (v, p) =>
    asNumber(v, p, { integer: true, min: 0, exclusiveMin: true }),
  );

  if (trigger === 'interval' && intervalMs === null) {
    fail(`${path}.intervalMs`, 'trigger "interval" requires an intervalMs, got null');
  }
  if (trigger !== 'interval' && intervalMs !== null) {
    fail(`${path}.intervalMs`, `trigger ${JSON.stringify(trigger)} does not use intervalMs, expected null`);
  }

  return {
    id: asString(object['id'], `${path}.id`),
    name: asString(object['name'], `${path}.name`),
    description: asString(object['description'], `${path}.description`),
    trigger,
    intervalMs,
    cooldownMs: asNullOr(object['cooldownMs'], `${path}.cooldownMs`, (v, p) =>
      asNumber(v, p, { integer: true, min: 0, exclusiveMin: true }),
    ),
    chance: asNumber(object['chance'], `${path}.chance`, UNIT_INTERVAL),
    effects: parseEffects(object['effects'], `${path}.effects`),
    artKey: asString(object['artKey'], `${path}.artKey`),
  };
}

// ---------------------------------------------------------------------------
// Synergies
// ---------------------------------------------------------------------------

function parseSynergyThreshold(raw: unknown, path: string): SynergyThreshold {
  const object = asObject(raw, path);
  exactKeys(object, path, ['count', 'description', 'effects']);
  return {
    count: asNumber(object['count'], `${path}.count`, { integer: true, min: 1 }),
    description: asString(object['description'], `${path}.description`),
    effects: parseEffects(object['effects'], `${path}.effects`),
  };
}

function parseSynergy(raw: unknown, path: string): SynergyDef {
  const object = asObject(raw, path);
  exactKeys(object, path, [
    'id',
    'name',
    'tag',
    'description',
    'thresholds',
    'artKey',
  ]);

  const rawThresholds = asArray(object['thresholds'], `${path}.thresholds`);
  if (rawThresholds.length === 0) {
    fail(`${path}.thresholds`, 'expected at least one threshold');
  }
  const thresholds = rawThresholds.map((threshold, index) =>
    parseSynergyThreshold(threshold, `${path}.thresholds[${index}]`),
  );
  // Core applies the highest satisfied tier, which assumes ascending order.
  for (let i = 1; i < thresholds.length; i += 1) {
    const previous = thresholds[i - 1] as SynergyThreshold;
    const current = thresholds[i] as SynergyThreshold;
    if (current.count <= previous.count) {
      fail(`${path}.thresholds[${i}].count`, `thresholds must ascend, got ${current.count} after ${previous.count}`);
    }
  }

  return {
    id: asString(object['id'], `${path}.id`),
    name: asString(object['name'], `${path}.name`),
    tag: asEnum(object['tag'], `${path}.tag`, UNIT_TAGS),
    description: asString(object['description'], `${path}.description`),
    thresholds,
    artKey: asString(object['artKey'], `${path}.artKey`),
  };
}

// ---------------------------------------------------------------------------
// Relics
// ---------------------------------------------------------------------------

function parseRelicCondition(raw: unknown, path: string): RelicCondition {
  const object = asObject(raw, path);
  exactKeys(object, path, ['kind', 'value', 'tag']);
  const kind = asEnum(object['kind'], `${path}.kind`, RELIC_CONDITION_KINDS);
  const value = asNullOr(object['value'], `${path}.value`, (v, p) => asNumber(v, p));
  const tag = asNullOr(object['tag'], `${path}.tag`, (v, p) => asEnum(v, p, UNIT_TAGS));

  if (kind === 'always' && (value !== null || tag !== null)) {
    fail(path, 'condition "always" takes no value or tag, expected both null');
  }
  if (kind !== 'always' && value === null) {
    fail(`${path}.value`, `condition ${JSON.stringify(kind)} requires a value, got null`);
  }
  if (kind === 'tagCountAtLeast' && tag === null) {
    fail(`${path}.tag`, 'condition "tagCountAtLeast" requires a tag, got null');
  }
  return { kind, value, tag };
}

function parseRelicAction(raw: unknown, path: string): RelicAction {
  const object = asObject(raw, path);
  const kind = asEnum(object['kind'], `${path}.kind`, RELIC_ACTION_KINDS);

  switch (kind) {
    case 'grantGold':
      exactKeys(object, path, ['kind', 'amount']);
      return {
        kind,
        amount: asNumber(object['amount'], `${path}.amount`, { integer: true }),
      };
    case 'grantReroll':
      exactKeys(object, path, ['kind', 'amount']);
      return {
        kind,
        amount: asNumber(object['amount'], `${path}.amount`, { integer: true }),
      };
    case 'grantUnit':
      exactKeys(object, path, ['kind', 'unitId', 'count']);
      return {
        kind,
        unitId: asString(object['unitId'], `${path}.unitId`),
        count: asNumber(object['count'], `${path}.count`, { integer: true, min: 1 }),
      };
    case 'shopOdds':
      exactKeys(object, path, ['kind', 'tag', 'weightMult']);
      return {
        kind,
        tag: asNullOr(object['tag'], `${path}.tag`, (v, p) => asEnum(v, p, UNIT_TAGS)),
        weightMult: asNumber(object['weightMult'], `${path}.weightMult`, {
          min: 0,
          exclusiveMin: true,
        }),
      };
    case 'applyEffect':
      exactKeys(object, path, ['kind', 'effect']);
      return { kind, effect: parseEffect(object['effect'], `${path}.effect`) };
    default:
      fail(`${path}.kind`, `unknown relic action ${JSON.stringify(kind)}`);
  }
}

function parseRelicHook(raw: unknown, path: string): RelicHook {
  const object = asObject(raw, path);
  exactKeys(object, path, ['on', 'condition', 'chance', 'actions']);
  const rawActions = asArray(object['actions'], `${path}.actions`);
  if (rawActions.length === 0) {
    fail(`${path}.actions`, 'expected at least one action');
  }
  return {
    on: asEnum(object['on'], `${path}.on`, RELIC_TRIGGERS),
    condition: parseRelicCondition(object['condition'], `${path}.condition`),
    chance: asNumber(object['chance'], `${path}.chance`, { min: 0, max: 1 }),
    actions: rawActions.map((action, index) =>
      parseRelicAction(action, `${path}.actions[${index}]`),
    ),
  };
}

function parseRelic(raw: unknown, path: string): RelicDef {
  const object = asObject(raw, path);
  exactKeys(object, path, ['id', 'name', 'rarity', 'description', 'hooks', 'artKey']);
  const rawHooks = asArray(object['hooks'], `${path}.hooks`);
  if (rawHooks.length === 0) {
    fail(`${path}.hooks`, 'expected at least one hook');
  }
  return {
    id: asString(object['id'], `${path}.id`),
    name: asString(object['name'], `${path}.name`),
    rarity: asEnum(object['rarity'], `${path}.rarity`, RELIC_RARITIES),
    description: asString(object['description'], `${path}.description`),
    hooks: rawHooks.map((hook, index) => parseRelicHook(hook, `${path}.hooks[${index}]`)),
    artKey: asString(object['artKey'], `${path}.artKey`),
  };
}

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

function parsePlacement(raw: unknown, path: string): EnemyPlacement {
  const object = asObject(raw, path);
  exactKeys(object, path, ['unitId', 'col', 'row']);
  const row = asNumber(object['row'], `${path}.row`, {
    integer: true,
    min: 0,
    max: BOARD.rows - 1,
  });
  if (!(BOARD.enemyRows as readonly number[]).includes(row)) {
    fail(`${path}.row`, `enemies must be placed on rows ${BOARD.enemyRows.join(' or ')}, got ${row}`);
  }
  return {
    unitId: asString(object['unitId'], `${path}.unitId`),
    col: asNumber(object['col'], `${path}.col`, {
      integer: true,
      min: 0,
      max: BOARD.cols - 1,
    }),
    row,
  };
}

function parseEncounter(raw: unknown, path: string): EncounterDef {
  const object = asObject(raw, path);
  exactKeys(object, path, [
    'id',
    'round',
    'name',
    'boss',
    'placements',
    'goldReward',
    'artKey',
  ]);

  const rawPlacements = asArray(object['placements'], `${path}.placements`);
  if (rawPlacements.length === 0) {
    fail(`${path}.placements`, 'expected at least one placement');
  }
  const placements = rawPlacements.map((placement, index) =>
    parsePlacement(placement, `${path}.placements[${index}]`),
  );

  const occupied = new Set<string>();
  for (const placement of placements) {
    const cell = `${placement.col},${placement.row}`;
    if (occupied.has(cell)) {
      fail(`${path}.placements`, `two enemies occupy cell (col ${placement.col}, row ${placement.row})`);
    }
    occupied.add(cell);
  }

  return {
    id: asString(object['id'], `${path}.id`),
    round: asNumber(object['round'], `${path}.round`, { integer: true, min: 1 }),
    name: asString(object['name'], `${path}.name`),
    boss: asBoolean(object['boss'], `${path}.boss`),
    placements,
    goldReward: asNumber(object['goldReward'], `${path}.goldReward`, {
      integer: true,
      min: 0,
    }),
    artKey: asString(object['artKey'], `${path}.artKey`),
  };
}

// ---------------------------------------------------------------------------
// Run configuration
// ---------------------------------------------------------------------------

function parseRunRules(raw: unknown, path: string): RunRules {
  const object = asObject(raw, path);
  exactKeys(object, path, [
    'rounds',
    'bossRounds',
    'startingLives',
    'startingGold',
    'baseIncome',
    'incomePerRound',
    'winBonusGold',
    'interestPerGold',
    'interestCap',
    'rerollCost',
    'shopSlots',
    'rewardChoices',
    'rewardRandomShare',
    'rewardTagAffinity',
    'sellRefundShare',
  ]);

  const rounds = asNumber(object['rounds'], `${path}.rounds`, { integer: true, min: 1 });
  const bossRounds = asArray(object['bossRounds'], `${path}.bossRounds`).map((value, index) =>
    asNumber(value, `${path}.bossRounds[${index}]`, { integer: true, min: 1, max: rounds }),
  );
  for (let i = 1; i < bossRounds.length; i += 1) {
    // Ascending and distinct, so "the next boss" is a scan rather than a sort.
    if ((bossRounds[i] ?? 0) <= (bossRounds[i - 1] ?? 0)) {
      fail(`${path}.bossRounds`, `expected strictly ascending rounds, got ${bossRounds.join(', ')}`);
    }
  }

  return {
    rounds,
    bossRounds,
    startingLives: asNumber(object['startingLives'], `${path}.startingLives`, {
      integer: true,
      min: 1,
    }),
    startingGold: asNumber(object['startingGold'], `${path}.startingGold`, {
      integer: true,
      min: 0,
    }),
    baseIncome: asNumber(object['baseIncome'], `${path}.baseIncome`, {
      integer: true,
      min: 0,
    }),
    incomePerRound: asNumber(object['incomePerRound'], `${path}.incomePerRound`, {
      integer: true,
      min: 0,
    }),
    winBonusGold: asNumber(object['winBonusGold'], `${path}.winBonusGold`, {
      integer: true,
      min: 0,
    }),
    interestPerGold: asNumber(object['interestPerGold'], `${path}.interestPerGold`, {
      integer: true,
      min: 1,
    }),
    interestCap: asNumber(object['interestCap'], `${path}.interestCap`, {
      integer: true,
      min: 0,
    }),
    rerollCost: asNumber(object['rerollCost'], `${path}.rerollCost`, {
      integer: true,
      min: 0,
    }),
    shopSlots: asNumber(object['shopSlots'], `${path}.shopSlots`, { integer: true, min: 1 }),
    rewardChoices: asNumber(object['rewardChoices'], `${path}.rewardChoices`, {
      integer: true,
      min: 1,
    }),
    rewardRandomShare: asNumber(object['rewardRandomShare'], `${path}.rewardRandomShare`, {
      min: 0,
      max: 1,
    }),
    rewardTagAffinity: asNumber(object['rewardTagAffinity'], `${path}.rewardTagAffinity`, {
      min: 0,
    }),
    sellRefundShare: asNumber(object['sellRefundShare'], `${path}.sellRefundShare`, {
      min: 0,
      max: 1,
    }),
  };
}

function parseRarityWeight(raw: unknown, path: string): RarityWeight {
  const object = asObject(raw, path);
  exactKeys(object, path, ['rarity', 'weight', 'minRound']);
  return {
    rarity: asEnum(object['rarity'], `${path}.rarity`, RELIC_RARITIES),
    weight: asNumber(object['weight'], `${path}.weight`, { min: 0 }),
    minRound: asNumber(object['minRound'], `${path}.minRound`, { integer: true, min: 1 }),
  };
}

function parseShopTierOdds(raw: unknown, path: string): ShopTierOdds {
  const object = asObject(raw, path);
  exactKeys(object, path, ['round', 'tier1', 'tier2', 'tier3']);
  const row: ShopTierOdds = {
    round: asNumber(object['round'], `${path}.round`, { integer: true, min: 1 }),
    tier1: asNumber(object['tier1'], `${path}.tier1`, { min: 0 }),
    tier2: asNumber(object['tier2'], `${path}.tier2`, { min: 0 }),
    tier3: asNumber(object['tier3'], `${path}.tier3`, { min: 0 }),
  };
  // A row of zeroes would leave the shop with nothing to offer and no way to
  // say so; catching it here beats catching it as an empty shop at round 9.
  if (row.tier1 + row.tier2 + row.tier3 <= 0) {
    fail(path, 'expected at least one tier to have a non-zero weight');
  }
  return row;
}

function parseRunConfig(raw: unknown): RunConfig {
  const object = asObject(raw, 'run');
  exactKeys(object, 'run', ['version', 'rules', 'rarityWeights', 'shopTierOdds']);

  const rules = parseRunRules(object['rules'], 'run.rules');
  const rarityWeights = validateEach(
    asArray(object['rarityWeights'], 'run.rarityWeights'),
    'run.rarityWeights',
    parseRarityWeight,
  );
  const shopTierOdds = validateEach(
    asArray(object['shopTierOdds'], 'run.shopTierOdds'),
    'run.shopTierOdds',
    parseShopTierOdds,
  ).sort((a, b) => a.round - b.round);

  return { rules, rarityWeights, shopTierOdds };
}

/** Version of `run.json`, read separately so it can join the version check. */
function runConfigVersion(raw: unknown): number {
  const object = asObject(raw, 'run');
  return asNumber(object['version'], 'run.version', { integer: true, min: 1 });
}

// ---------------------------------------------------------------------------
// Cross-reference validation
// ---------------------------------------------------------------------------

/**
 * Detects a cycle in the merge graph.
 *
 * The tier rule already makes cycles impossible in valid data, but this check
 * does not assume the tier rule holds — it is the backstop that catches a
 * merge graph that loops for any reason, including a mis-tiered unit.
 */
function findMergeCycle(units: ReadonlyMap<string, UnitDef>): string[] | null {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const current = state.get(id);
    if (current === DONE) return null;
    if (current === VISITING) {
      // Return the cycle itself, so the error names the units involved.
      return [...stack.slice(stack.indexOf(id)), id];
    }

    state.set(id, VISITING);
    stack.push(id);
    for (const target of units.get(id)?.mergesInto ?? []) {
      if (!units.has(target)) continue; // reported separately as a bad reference
      const cycle = visit(target);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    state.set(id, DONE);
    return null;
  };

  for (const id of units.keys()) {
    const cycle = visit(id);
    if (cycle !== null) return cycle;
  }
  return null;
}

function checkCrossReferences(data: GameData): void {
  const issues = new IssueCollector();
  const { units, abilities } = data;

  for (const unit of units.values()) {
    const path = `units[${unit.id}]`;

    if (unit.abilityId !== null && !abilities.has(unit.abilityId)) {
      issues.add(
        `${path}.abilityId`,
        `references unknown ability ${JSON.stringify(unit.abilityId)}`,
      );
    }

    unit.mergesInto.forEach((targetId, index) => {
      const target = units.get(targetId);
      if (target === undefined) {
        issues.add(
          `${path}.mergesInto[${index}]`,
          `references unknown unit ${JSON.stringify(targetId)}`,
        );
        return;
      }
      // Merges must climb exactly one tier: this is what makes the graph a DAG
      // and what lets the shop reason about upgrade depth.
      issues.check(
        target.tier === unit.tier + 1,
        `${path}.mergesInto[${index}]`,
        `tier ${unit.tier} unit must merge into a tier ${unit.tier + 1} unit, but ${JSON.stringify(targetId)} is tier ${target.tier}`,
      );
      issues.check(
        targetId !== unit.id,
        `${path}.mergesInto[${index}]`,
        'a unit cannot merge into itself',
      );
    });
  }

  for (const ability of abilities.values()) {
    for (const effect of walkEffects(ability.effects)) {
      if (effect.kind === 'summon' && !units.has(effect.unitId)) {
        issues.add(
          `abilities[${ability.id}]`,
          `summons unknown unit ${JSON.stringify(effect.unitId)}`,
        );
      }
    }
  }

  for (const synergy of data.synergies.values()) {
    for (const [index, threshold] of synergy.thresholds.entries()) {
      for (const effect of walkEffects(threshold.effects)) {
        if (effect.kind === 'summon' && !units.has(effect.unitId)) {
          issues.add(
            `synergies[${synergy.id}].thresholds[${index}]`,
            `summons unknown unit ${JSON.stringify(effect.unitId)}`,
          );
        }
      }
    }
  }

  const battleTriggers = new Set<string>(BATTLE_RELIC_TRIGGERS);
  for (const relic of data.relics.values()) {
    for (const [index, hook] of relic.hooks.entries()) {
      const hookPath = `relics[${relic.id}].hooks[${index}]`;

      // A hook that fires inside a battle can only ask questions a battle can
      // answer. Gold and round number are run state and never cross into
      // `src/core/battle`, so a relic asking for them there would silently
      // never fire.
      if (battleTriggers.has(hook.on)) {
        issues.check(
          hook.condition.kind === 'always' || hook.condition.kind === 'tagCountAtLeast',
          `${hookPath}.condition.kind`,
          `trigger ${JSON.stringify(hook.on)} fires inside a battle, which cannot evaluate ${JSON.stringify(hook.condition.kind)} — use "always" or "tagCountAtLeast"`,
        );
        issues.check(
          hook.actions.every((action) => action.kind === 'applyEffect'),
          `${hookPath}.actions`,
          `trigger ${JSON.stringify(hook.on)} fires inside a battle, where only "applyEffect" actions have any meaning`,
        );
      } else {
        issues.check(
          hook.actions.every((action) => action.kind !== 'applyEffect'),
          `${hookPath}.actions`,
          `trigger ${JSON.stringify(hook.on)} fires outside a battle, where "applyEffect" has nothing to apply to`,
        );
      }

      for (const action of hook.actions) {
        const path = hookPath;
        if (action.kind === 'grantUnit' && !units.has(action.unitId)) {
          issues.add(path, `grants unknown unit ${JSON.stringify(action.unitId)}`);
        }
        if (action.kind === 'applyEffect') {
          for (const effect of walkEffects([action.effect])) {
            if (effect.kind === 'summon' && !units.has(effect.unitId)) {
              issues.add(path, `summons unknown unit ${JSON.stringify(effect.unitId)}`);
            }
          }
        }
      }
    }
  }

  for (const encounter of data.encounters) {
    encounter.placements.forEach((placement, index) => {
      issues.check(
        units.has(placement.unitId),
        `encounters[${encounter.id}].placements[${index}].unitId`,
        `references unknown unit ${JSON.stringify(placement.unitId)}`,
      );
    });
  }

  const seenTags = new Set<UnitTag>();
  for (const synergy of data.synergies.values()) {
    if (seenTags.has(synergy.tag)) {
      issues.add(
        `synergies[${synergy.id}].tag`,
        `a second synergy already claims tag ${JSON.stringify(synergy.tag)}`,
      );
    }
    seenTags.add(synergy.tag);
  }

  const cycle = findMergeCycle(units);
  if (cycle !== null) {
    issues.add('units', `merge graph contains a cycle: ${cycle.join(' -> ')}`);
  }

  checkRunReferences(data, issues);
  issues.throwIfAny();
}

/**
 * Ties `run.json` to the rest of the content.
 *
 * The run configuration is the one file that says how many rounds there are, so
 * everything else has to line up with it: an encounter per round, the boss flags
 * matching the boss rounds, and a shop-odds row per round. A missing round 9
 * would otherwise surface as a crash nine rounds into a playthrough.
 */
function checkRunReferences(data: GameData, issues: IssueCollector): void {
  const { rules, shopTierOdds, rarityWeights } = data.run;
  const bossRounds = new Set(rules.bossRounds);

  const byRound = new Map<number, EncounterDef[]>();
  for (const encounter of data.encounters) {
    const list = byRound.get(encounter.round) ?? [];
    list.push(encounter);
    byRound.set(encounter.round, list);
  }

  for (let round = 1; round <= rules.rounds; round += 1) {
    const encounters = byRound.get(round) ?? [];
    if (encounters.length === 0) {
      issues.add('encounters', `no encounter for round ${round} of ${rules.rounds}`);
      continue;
    }
    for (const encounter of encounters) {
      issues.check(
        encounter.boss === bossRounds.has(round),
        `encounters[${encounter.id}].boss`,
        bossRounds.has(round)
          ? `round ${round} is a boss round in run.json, so boss must be true`
          : `round ${round} is not a boss round in run.json, so boss must be false`,
      );
    }
    issues.check(
      shopTierOdds.some((row) => row.round === round),
      'run.shopTierOdds',
      `no shop odds row for round ${round}`,
    );
  }

  for (const encounter of data.encounters) {
    issues.check(
      encounter.round <= rules.rounds,
      `encounters[${encounter.id}].round`,
      `round ${encounter.round} is past the last round (${rules.rounds})`,
    );
  }

  const seenRarities = new Set<string>();
  for (const entry of rarityWeights) {
    issues.check(
      !seenRarities.has(entry.rarity),
      'run.rarityWeights',
      `rarity ${JSON.stringify(entry.rarity)} is weighted twice`,
    );
    seenRarities.add(entry.rarity);
  }
  for (const relic of data.relics.values()) {
    issues.check(
      seenRarities.has(relic.rarity),
      `relics[${relic.id}].rarity`,
      `rarity ${JSON.stringify(relic.rarity)} has no weight in run.rarityWeights, so the relic can never be offered`,
    );
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** The raw, unvalidated JSON documents that make up the content set. */
export interface RawContent {
  readonly units: unknown;
  readonly abilities: unknown;
  readonly synergies: unknown;
  readonly relics: unknown;
  readonly encounters: unknown;
  readonly run: unknown;
}

/** Unwraps a `{ version, <key>: [...] }` document. */
function unwrap(raw: unknown, key: string): { version: number; items: unknown[] } {
  const object = asObject(raw, key);
  exactKeys(object, key, ['version', key]);
  return {
    version: asNumber(object['version'], `${key}.version`, { integer: true, min: 1 }),
    items: asArray(object[key], `${key}.${key}`),
  };
}

/**
 * Validates raw JSON and returns indexed content.
 *
 * @throws {DataValidationError} listing every field that failed, with its path.
 */
export function loadGameData(raw: RawContent): GameData {
  const units = unwrap(raw.units, 'units');
  const abilities = unwrap(raw.abilities, 'abilities');
  const synergies = unwrap(raw.synergies, 'synergies');
  const relics = unwrap(raw.relics, 'relics');
  const encounters = unwrap(raw.encounters, 'encounters');
  const runVersion = runConfigVersion(raw.run);

  const versions = [
    units.version,
    abilities.version,
    synergies.version,
    relics.version,
    encounters.version,
    runVersion,
  ];
  if (new Set(versions).size !== 1) {
    throw new DataValidationError([
      `content: files disagree on version (units=${units.version}, abilities=${abilities.version}, synergies=${synergies.version}, relics=${relics.version}, encounters=${encounters.version}, run=${runVersion})`,
    ]);
  }

  const data: GameData = {
    version: units.version,
    units: indexById(validateEach(units.items, 'units', parseUnit), 'units'),
    abilities: indexById(
      validateEach(abilities.items, 'abilities', parseAbility),
      'abilities',
    ),
    synergies: indexById(
      validateEach(synergies.items, 'synergies', parseSynergy),
      'synergies',
    ),
    relics: indexById(validateEach(relics.items, 'relics', parseRelic), 'relics'),
    encounters: validateEach(encounters.items, 'encounters', parseEncounter).sort(
      (a, b) => a.round - b.round,
    ),
    run: parseRunConfig(raw.run),
  };

  checkCrossReferences(data);
  return data;
}

/** The content files as imported, before validation. Exposed for tests. */
export const bundledContent: RawContent = {
  units: unitsJson,
  abilities: abilitiesJson,
  synergies: synergiesJson,
  relics: relicsJson,
  encounters: encountersJson,
  run: runJson,
};

let cached: GameData | null = null;

/**
 * Loads and caches the bundled content. Validation runs once per process; the
 * simulator and the game both call this.
 */
export function loadBundledGameData(): GameData {
  cached ??= loadGameData(bundledContent);
  return cached;
}

/**
 * Resolves a unit's merge-direction choices to full definitions.
 *
 * This is the shape the merge UI needs — the player is choosing between these
 * units, so they must be presentable, not just id strings.
 */
export function mergeOptionsOf(data: GameData, unitId: string): UnitDef[] {
  const unit = data.units.get(unitId);
  if (unit === undefined) {
    throw new Error(`unknown unit ${JSON.stringify(unitId)}`);
  }
  return unit.mergesInto.map((id) => {
    const target = data.units.get(id);
    if (target === undefined) {
      throw new Error(`unit ${JSON.stringify(unitId)} merges into unknown ${JSON.stringify(id)}`);
    }
    return target;
  });
}

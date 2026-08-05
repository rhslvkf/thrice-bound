import { describe, expect, it } from 'vitest';
import { bundledContent, loadGameData, mergeOptionsOf, type RawContent } from './loader';
import { DataValidationError } from './validate';

/**
 * These tests deliberately break the content and assert the loader complains.
 *
 * The integrity tests in `content.test.ts` only prove the *current* files are
 * clean — they would still pass if every check were commented out. This file
 * is what proves the checks work.
 */

interface MutableContent {
  version: number;
  units: Record<string, unknown>[];
  abilities: Record<string, unknown>[];
  synergies: Record<string, unknown>[];
  relics: Record<string, unknown>[];
  encounters: Record<string, unknown>[];
}

type Section = keyof Omit<MutableContent, 'version'>;

/** Deep-clones the real content, applies a mutation, and returns raw input. */
function corrupt(mutate: (content: Record<Section, MutableContent>) => void): RawContent {
  const clone = structuredClone(bundledContent) as unknown as Record<
    Section,
    MutableContent
  >;
  mutate(clone);
  return clone as unknown as RawContent;
}

/** Loads corrupted content and returns the issues it reported. */
function issuesFrom(mutate: (content: Record<Section, MutableContent>) => void): string[] {
  try {
    loadGameData(corrupt(mutate));
  } catch (error) {
    if (error instanceof DataValidationError) return [...error.issues];
    throw error;
  }
  throw new Error('expected loadGameData to throw, but it succeeded');
}

/** Reads an array element, failing the test rather than asserting non-null. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`test fixture has no element ${index}`);
  return item;
}

/** Finds a definition by id inside a cloned section. */
function find(
  content: Record<Section, MutableContent>,
  section: Section,
  id: string,
): Record<string, unknown> {
  const found = content[section][section].find((item) => item['id'] === id);
  if (found === undefined) throw new Error(`test fixture missing ${section} ${id}`);
  return found;
}

describe('the real content is valid', () => {
  it('loads without issues', () => {
    expect(() => loadGameData(bundledContent)).not.toThrow();
  });
});

describe('shape validation', () => {
  it('names a missing field', () => {
    const issues = issuesFrom((c) => {
      delete find(c, 'units', 'unit.thornling')['cost'];
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('units[0]');
    expect(issues[0]).toContain('missing required field(s): cost');
  });

  it('rejects an unknown field rather than ignoring it', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.thornling')['atkspeed'] = 1;
    });
    expect(issues[0]).toContain('unexpected field(s): atkspeed');
  });

  it('reports the expected type and the value it got', () => {
    const issues = issuesFrom((c) => {
      (find(c, 'units', 'unit.thornling')['stats'] as Record<string, unknown>)['hp'] =
        'lots';
    });
    expect(issues[0]).toContain('units[0].stats.hp');
    expect(issues[0]).toContain('expected a finite number');
    expect(issues[0]).toContain('string "lots"');
  });

  it('rejects a stat that is zero or negative', () => {
    const issues = issuesFrom((c) => {
      (find(c, 'units', 'unit.thornling')['stats'] as Record<string, unknown>)[
        'atkSpeed'
      ] = 0;
    });
    expect(issues[0]).toContain('expected a number greater than 0');
  });

  it('lists the allowed values for a bad enum', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.thornling')['tags'] = ['Plasma'];
    });
    expect(issues[0]).toContain('units[0].tags[0]');
    expect(issues[0]).toContain('"Beast"');
    expect(issues[0]).toContain('string "Plasma"');
  });

  it('reports every broken unit at once, not just the first', () => {
    const issues = issuesFrom((c) => {
      delete find(c, 'units', 'unit.thornling')['cost'];
      delete find(c, 'units', 'unit.dire_pup')['name'];
      find(c, 'units', 'unit.grave_rat')['tier'] = 9;
    });
    expect(issues).toHaveLength(3);
  });

  it('rejects duplicate ids instead of silently overwriting', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.dire_pup')['id'] = 'unit.thornling';
    });
    expect(issues[0]).toContain('duplicate id "unit.thornling"');
  });

  it('rejects content files that disagree on version', () => {
    const issues = issuesFrom((c) => {
      c.units.version = 2;
    });
    expect(issues[0]).toContain('files disagree on version');
  });
});

describe('merge rules', () => {
  it('rejects a merge target that does not exist', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.thornling')['mergesInto'] = [
        'unit.nonexistent',
        'unit.moss_warden',
      ];
    });
    expect(issues[0]).toContain('references unknown unit "unit.nonexistent"');
  });

  it('rejects a tier 1 unit with only one merge direction', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.thornling')['mergesInto'] = ['unit.moss_warden'];
    });
    expect(issues[0]).toContain('must offer at least 2 merge targets, got 1');
  });

  it('rejects a tier 3 unit that is not terminal', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.verdant_colossus')['mergesInto'] = ['unit.primal_avatar'];
    });
    expect(issues[0]).toContain('tier 3 units are terminal');
  });

  it('rejects a merge that skips a tier', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.thornling')['mergesInto'] = [
        'unit.verdant_colossus',
        'unit.moss_warden',
      ];
    });
    expect(issues[0]).toContain(
      'tier 1 unit must merge into a tier 2 unit, but "unit.verdant_colossus" is tier 3',
    );
  });

  it('rejects a unit that merges into itself', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.thornling')['mergesInto'] = [
        'unit.thornling',
        'unit.moss_warden',
      ];
    });
    expect(issues.join('\n')).toContain('a unit cannot merge into itself');
  });

  it('rejects duplicate merge directions', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.thornling')['mergesInto'] = [
        'unit.moss_warden',
        'unit.moss_warden',
      ];
    });
    expect(issues[0]).toContain('duplicate merge target "unit.moss_warden"');
  });

  it('detects a cycle and names the units in it', () => {
    // Two tier 2 units pointing at each other. The tier rule catches this too,
    // but the cycle detector must not depend on that.
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.bramble_stalker')['mergesInto'] = [
        'unit.moss_warden',
        'unit.verdant_colossus',
      ];
      find(c, 'units', 'unit.moss_warden')['mergesInto'] = [
        'unit.bramble_stalker',
        'unit.bone_leviathan',
      ];
    });
    const cycleIssue = issues.find((issue) => issue.includes('cycle'));
    expect(cycleIssue).toBeDefined();
    expect(cycleIssue).toContain('unit.bramble_stalker');
    expect(cycleIssue).toContain('unit.moss_warden');
  });
});

describe('reference validation', () => {
  it('rejects an unknown abilityId', () => {
    const issues = issuesFrom((c) => {
      find(c, 'units', 'unit.thornling')['abilityId'] = 'ability.nope';
    });
    expect(issues[0]).toContain('references unknown ability "ability.nope"');
  });

  it('rejects a summon of an unknown unit', () => {
    const issues = issuesFrom((c) => {
      const ability = find(c, 'abilities', 'ability.raise_wisp');
      at(ability['effects'] as Record<string, unknown>[], 0)['unitId'] = 'unit.ghost';
    });
    expect(issues[0]).toContain('summons unknown unit "unit.ghost"');
  });

  it('rejects a relic granting an unknown unit', () => {
    const issues = issuesFrom((c) => {
      const relic = find(c, 'relics', 'relic.thrice_bound_seal');
      const hook = at(relic['hooks'] as Record<string, unknown>[], 0);
      at(hook['actions'] as Record<string, unknown>[], 1)['unitId'] = 'unit.ghost';
    });
    expect(issues[0]).toContain('grants unknown unit "unit.ghost"');
  });

  it('rejects an encounter placing an unknown unit', () => {
    const issues = issuesFrom((c) => {
      const encounter = find(c, 'encounters', 'encounter.r1_scurry');
      at(encounter['placements'] as Record<string, unknown>[], 0)['unitId'] = 'unit.ghost';
    });
    expect(issues[0]).toContain('references unknown unit "unit.ghost"');
  });

  it('rejects two synergies claiming the same tag', () => {
    const issues = issuesFrom((c) => {
      find(c, 'synergies', 'synergy.undead')['tag'] = 'Beast';
    });
    expect(issues.join('\n')).toContain('a second synergy already claims tag "Beast"');
  });
});

describe('effect validation', () => {
  it('rejects an unknown effect kind', () => {
    const issues = issuesFrom((c) => {
      const ability = find(c, 'abilities', 'ability.spark_bolt');
      at(ability['effects'] as Record<string, unknown>[], 0)['kind'] = 'teleport';
    });
    expect(issues[0]).toContain('unknown effect kind "teleport"');
  });

  it('rejects a target mode that is missing its qualifier', () => {
    const issues = issuesFrom((c) => {
      const ability = find(c, 'abilities', 'ability.void_rift');
      const effect = at(ability['effects'] as Record<string, unknown>[], 0);
      (effect['target'] as Record<string, unknown>)['count'] = null;
    });
    expect(issues[0]).toContain('target mode "randomEnemy" requires a count, got null');
  });

  it('rejects a qualifier the target mode does not use', () => {
    const issues = issuesFrom((c) => {
      const ability = find(c, 'abilities', 'ability.spark_bolt');
      const effect = at(ability['effects'] as Record<string, unknown>[], 0);
      (effect['target'] as Record<string, unknown>)['radius'] = 3;
    });
    expect(issues[0]).toContain('target mode "attackTarget" does not use radius');
  });

  it('rejects an interval ability with no interval', () => {
    const issues = issuesFrom((c) => {
      find(c, 'abilities', 'ability.ember_nova')['intervalMs'] = null;
    });
    expect(issues[0]).toContain('trigger "interval" requires an intervalMs');
  });

  it('rejects an intervalMs on a non-interval trigger', () => {
    const issues = issuesFrom((c) => {
      find(c, 'abilities', 'ability.spark_bolt')['intervalMs'] = 1000;
    });
    expect(issues[0]).toContain('trigger "onAttack" does not use intervalMs');
  });

  it('rejects a proc chance outside [0, 1]', () => {
    const issues = issuesFrom((c) => {
      find(c, 'abilities', 'ability.spark_bolt')['chance'] = 1.5;
    });
    expect(issues[0]).toContain('expected a number <= 1');
  });

  it('rejects effects nested past the depth limit', () => {
    const issues = issuesFrom((c) => {
      const nest = (depth: number): Record<string, unknown> =>
        depth === 0
          ? {
              kind: 'heal',
              target: { mode: 'self', count: null, radius: null, tag: null },
              amount: 1,
              scaleWithMaxHp: null,
            }
          : { kind: 'periodic', periodMs: 1000, effects: [nest(depth - 1)] };
      find(c, 'abilities', 'ability.rooted_growth')['effects'] = [nest(6)];
    });
    expect(issues[0]).toContain('effect nesting exceeds the maximum depth');
  });
});

describe('synergy and encounter rules', () => {
  it('rejects thresholds that do not ascend', () => {
    const issues = issuesFrom((c) => {
      const synergy = find(c, 'synergies', 'synergy.beast');
      at(synergy['thresholds'] as Record<string, unknown>[], 1)['count'] = 2;
    });
    expect(issues[0]).toContain('thresholds must ascend, got 2 after 3');
  });

  it('rejects an enemy placed on a player row', () => {
    const issues = issuesFrom((c) => {
      const encounter = find(c, 'encounters', 'encounter.r1_scurry');
      at(encounter['placements'] as Record<string, unknown>[], 0)['row'] = 3;
    });
    expect(issues[0]).toContain('enemies must be placed on rows 0 or 1, got 3');
  });

  it('rejects two enemies stacked on one cell', () => {
    const issues = issuesFrom((c) => {
      const encounter = find(c, 'encounters', 'encounter.r1_scurry');
      at(encounter['placements'] as Record<string, unknown>[], 1)['col'] = 1;
    });
    expect(issues[0]).toContain('two enemies occupy cell (col 1, row 1)');
  });

  it('rejects a placement off the board', () => {
    const issues = issuesFrom((c) => {
      const encounter = find(c, 'encounters', 'encounter.r1_scurry');
      at(encounter['placements'] as Record<string, unknown>[], 0)['col'] = 5;
    });
    expect(issues[0]).toContain('expected a number <= 4');
  });
});

describe('mergeOptionsOf', () => {
  it('resolves merge directions to full definitions', () => {
    const data = loadGameData(bundledContent);
    const options = mergeOptionsOf(data, 'unit.thornling');
    expect(options.map((unit) => unit.id)).toEqual([
      'unit.bramble_stalker',
      'unit.moss_warden',
    ]);
    // The merge UI needs presentable data, not ids.
    expect(options[0]?.name).toBe('Bramble Stalker');
    expect(options[0]?.tier).toBe(2);
  });

  it('returns nothing for a terminal unit', () => {
    const data = loadGameData(bundledContent);
    expect(mergeOptionsOf(data, 'unit.verdant_colossus')).toEqual([]);
  });

  it('throws for an unknown unit', () => {
    const data = loadGameData(bundledContent);
    expect(() => mergeOptionsOf(data, 'unit.ghost')).toThrow('unknown unit');
  });
});

/**
 * Prints the merge tree as a text diagram.
 *
 * Run with `npm run data:tree`. Dev tooling only — nothing in `src/` imports
 * this, and it never ships in `dist/`.
 *
 * The merge graph is a DAG, not a tree: several tier 1 units share a tier 2
 * target, and every tier 2 unit in a tag shares its tier 3 targets. Shared
 * nodes are therefore printed under each parent that can reach them, and
 * marked so the convergence is visible.
 */

import { loadBundledGameData } from '../src/data/loader';
import { MAX_TIER, MIN_TIER, type GameData, type UnitDef } from '../src/data/schema';

const BRANCH = '├─ ';
const LAST_BRANCH = '└─ ';
const TRUNK = '│  ';
const GAP = '   ';

function label(unit: UnitDef, shared: boolean): string {
  const tags = unit.tags.join('/');
  const mark = shared ? '  *' : '';
  return `${unit.name} [T${unit.tier} ${tags}]${mark}`;
}

/** Counts how many units list each unit as a merge target. */
function countParents(data: GameData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const unit of data.units.values()) {
    for (const target of unit.mergesInto) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

function printSubtree(
  data: GameData,
  unit: UnitDef,
  parents: ReadonlyMap<string, number>,
  prefix: string,
  lines: string[],
): void {
  unit.mergesInto.forEach((targetId, index) => {
    const target = data.units.get(targetId);
    if (target === undefined) return;
    const isLast = index === unit.mergesInto.length - 1;
    const shared = (parents.get(targetId) ?? 0) > 1;
    lines.push(`${prefix}${isLast ? LAST_BRANCH : BRANCH}${label(target, shared)}`);
    printSubtree(data, target, parents, `${prefix}${isLast ? GAP : TRUNK}`, lines);
  });
}

function main(): void {
  const data = loadBundledGameData();
  const parents = countParents(data);
  const units = [...data.units.values()];
  const byTier = (tier: number): UnitDef[] => units.filter((u) => u.tier === tier);

  const lines: string[] = [];
  lines.push('THRICEBOUND merge tree');
  lines.push(
    `${units.length} units - ` +
      [MIN_TIER, 2, MAX_TIER].map((t) => `${byTier(t).length} at T${t}`).join(', '),
  );
  lines.push('');
  lines.push('Each branch is a merge-direction choice: three copies of the parent');
  lines.push('become one of the units listed directly beneath it.');
  lines.push('  *  reachable from more than one parent');
  lines.push('');

  for (const root of byTier(MIN_TIER)) {
    lines.push(label(root, false));
    printSubtree(data, root, parents, '', lines);
    lines.push('');
  }

  lines.push('Convergence');
  for (const unit of units) {
    const count = parents.get(unit.id) ?? 0;
    if (count > 1) {
      const sources = units
        .filter((u) => u.mergesInto.includes(unit.id))
        .map((u) => u.name)
        .join(', ');
      lines.push(`  ${unit.name} <- ${sources}`);
    }
  }

  const unreachable = units.filter(
    (unit) => unit.tier > MIN_TIER && (parents.get(unit.id) ?? 0) === 0,
  );
  lines.push('');
  lines.push(
    unreachable.length === 0
      ? 'Every unit above tier 1 is reachable by merging.'
      : `Unreachable: ${unreachable.map((u) => u.name).join(', ')}`,
  );

  console.log(lines.join('\n'));
}

main();

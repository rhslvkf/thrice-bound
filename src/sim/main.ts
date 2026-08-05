/**
 * Headless balance simulator.
 *
 * Runs battles under plain Node using exactly the code the browser runs — no
 * renderer, no mocks, no parallel implementation. That is only possible
 * because `src/core` is pure and takes an injected seeded RNG.
 *
 * Usage:
 *   npm run sim                 one battle on the default seed, in detail
 *   npm run sim -- 42           one battle on seed 42
 *   npm run sim -- 42 200       200 battles from seed 42, as a win-rate sweep
 */

import { runBattle } from '../core/battle/index';
import type { BattleEvent, BattleSetup, Deployment } from '../core/battle/index';
import { BATTLE } from '../core/config';
import { createRng } from '../core/rng';
import type { Rng } from '../core/rng';
import { loadBundledGameData } from '../data/loader';
import { BOARD } from '../data/schema';
import type { GameData } from '../data/schema';

const DEFAULT_SEED = 1;
const DEFAULT_BATTLES = 1;
/** Units per side in a generated matchup. */
const TEAM_SIZE = 4;
/**
 * Offsets the team-generation stream away from the battle's own seed, so
 * changing how teams are picked never shifts combat rolls.
 */
const TEAM_SEED_OFFSET = 0x5f37_59df;

/** Builds a reproducible team from the roster, filling the team's home rows. */
function randomTeam(data: GameData, rng: Rng, rows: readonly number[]): Deployment[] {
  const ids = [...data.units.keys()].sort();
  const deployments: Deployment[] = [];
  for (let i = 0; i < TEAM_SIZE; i += 1) {
    deployments.push({
      unitId: rng.pick(ids),
      col: Math.floor(i / rows.length) % BOARD.cols,
      row: rows[i % rows.length] ?? 0,
    });
  }
  return deployments;
}

/** A reproducible matchup for a seed. */
function generateSetup(data: GameData, seed: number): BattleSetup {
  const rng = createRng(seed ^ TEAM_SEED_OFFSET);
  return {
    seed,
    player: randomTeam(data, rng, BOARD.playerRows),
    enemy: randomTeam(data, rng, BOARD.enemyRows),
  };
}

function nameOf(data: GameData, unitId: string): string {
  return data.units.get(unitId)?.name ?? unitId;
}

function describeTeam(data: GameData, deployments: readonly Deployment[]): string {
  return deployments.map((d) => nameOf(data, d.unitId)).join(', ');
}

function countEvents(events: readonly BattleEvent[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/** Runs one battle and prints it in detail. */
function runSingle(data: GameData, setup: BattleSetup): void {
  const result = runBattle(data, setup);
  const seconds = ((result.ticks * BATTLE.tickMs) / BATTLE.msPerSecond).toFixed(1);

  console.log(`  seed        ${setup.seed}`);
  console.log(`  player      ${describeTeam(data, setup.player)}`);
  console.log(`  enemy       ${describeTeam(data, setup.enemy)}`);
  console.log('');
  console.log(`  outcome     ${result.outcome} (${result.reason})`);
  console.log(`  duration    ${result.ticks} ticks / ${seconds}s`);
  console.log(`  events      ${result.events.length}`);
  console.log(
    `              ${countEvents(result.events)
      .map(([kind, n]) => `${kind}=${n}`)
      .join('  ')}`,
  );

  const survivors = result.finalState.units.filter((unit) => unit.alive);
  const summary =
    survivors.length === 0
      ? 'none'
      : survivors
          .map(
            (unit) =>
              `${nameOf(data, unit.defId)} [${unit.team} ${Math.round(unit.hp)}/${Math.round(unit.maxHp)}]`,
          )
          .join(', ');
  console.log(`  survivors   ${summary}`);
}

/** Runs many battles on consecutive seeds and prints aggregate rates. */
function runSweep(data: GameData, baseSeed: number, battles: number): void {
  const tally = { player: 0, enemy: 0, draw: 0 };
  const reasons = new Map<string, number>();
  let totalTicks = 0;
  let totalEvents = 0;

  for (let i = 0; i < battles; i += 1) {
    const seed = baseSeed + i;
    const result = runBattle(data, generateSetup(data, seed));
    tally[result.outcome] += 1;
    reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
    totalTicks += result.ticks;
    totalEvents += result.events.length;
  }

  const pct = (n: number): string => `${((n / battles) * 100).toFixed(1)}%`;
  console.log(`  battles     ${battles} (seeds ${baseSeed}..${baseSeed + battles - 1})`);
  console.log(
    `  outcomes    player ${pct(tally.player)}   enemy ${pct(tally.enemy)}   draw ${pct(tally.draw)}`,
  );
  console.log(
    `  endings     ${[...reasons].map(([kind, n]) => `${kind} ${pct(n)}`).join('   ')}`,
  );
  console.log(`  avg ticks   ${(totalTicks / battles).toFixed(0)}`);
  console.log(`  avg events  ${(totalEvents / battles).toFixed(0)}`);
}

function main(argv: readonly string[]): void {
  const data = loadBundledGameData();
  const seed = Number.parseInt(argv[0] ?? '', 10);
  const battles = Number.parseInt(argv[1] ?? '', 10);
  const resolvedSeed = Number.isFinite(seed) ? seed : DEFAULT_SEED;
  const resolvedBattles = Number.isFinite(battles) ? battles : DEFAULT_BATTLES;

  console.log('THRICEBOUND balance simulator');
  console.log(
    `  content     ${data.units.size} units, ${data.abilities.size} abilities, ${data.synergies.size} synergies`,
  );
  console.log(`  tick        ${BATTLE.tickMs}ms`);
  console.log('');

  if (resolvedBattles > 1) runSweep(data, resolvedSeed, resolvedBattles);
  else runSingle(data, generateSetup(data, resolvedSeed));
}

main(process.argv.slice(2));

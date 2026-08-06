/**
 * Saving and resuming a run.
 *
 * A run is already plain data, so serializing it is `JSON.stringify`. The work
 * is on the way back in: a save comes from storage the player's browser owns,
 * which means it can be truncated, hand-edited, or written by a version of the
 * game that no longer exists. Every field is checked before it becomes a
 * {@link RunState}.
 *
 * A save that fails any check is **rejected, not repaired**. A partially
 * plausible run — round 7 with an empty board and a relic that no longer exists
 * — is worse than starting over, because it fails later and more confusingly.
 *
 * There is no storage here and no `localStorage`. This module turns a state
 * into a string and back; where that string lives is `src/meta`'s problem.
 */

import { BOARD, RELIC_RARITIES } from '../../data/schema';
import type { GameData } from '../../data/schema';
import { isPlayerCell } from './board';
import { RUN_PHASES, RUN_SAVE_VERSION } from './types';
import type { BoardSlot, RoundRecord, RunPhase, RunState, ShopSlot } from './types';

export interface LoadFailure {
  readonly ok: false;
  readonly reason: string;
}

export interface LoadSuccess {
  readonly ok: true;
  readonly state: RunState;
}

export type LoadResult = LoadSuccess | LoadFailure;

export function serializeRun(state: RunState): string {
  return JSON.stringify(state);
}

// --- narrowing helpers ------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, min = -Infinity): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= min ? value : null;
}

function int(value: unknown, min = -Infinity): number | null {
  const n = num(value, min);
  return n !== null && Number.isInteger(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    const s = str(entry);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

// --- field parsers ----------------------------------------------------------

function parseBoard(value: unknown, data: GameData): BoardSlot[] | null {
  if (!Array.isArray(value)) return null;
  const slots: BoardSlot[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const col = int(entry['col'], 0);
    const row = int(entry['row'], 0);
    const unitId = str(entry['unitId']);
    if (col === null || row === null || unitId === null) return null;
    if (!isPlayerCell(col, row)) return null;
    if (!data.units.has(unitId)) return null;

    const key = `${col},${row}`;
    if (seen.has(key)) return null;
    seen.add(key);
    slots.push({ col, row, unitId });
  }

  if (slots.length > BOARD.cols * BOARD.playerRows.length) return null;
  return slots.sort((a, b) => a.row - b.row || a.col - b.col);
}

function parseShop(value: unknown, data: GameData): ShopSlot[] | null {
  if (!Array.isArray(value)) return null;
  const slots: ShopSlot[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const raw = entry['unitId'];
    const locked = entry['locked'];
    if (typeof locked !== 'boolean') return null;
    if (raw === null) {
      slots.push({ unitId: null, locked });
      continue;
    }
    const unitId = str(raw);
    if (unitId === null || !data.units.has(unitId)) return null;
    slots.push({ unitId, locked });
  }
  return slots;
}

function parseHistory(value: unknown, data: GameData): RoundRecord[] | null {
  if (!Array.isArray(value)) return null;
  const records: RoundRecord[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const round = int(entry['round'], 1);
    const encounterId = str(entry['encounterId']);
    const outcome = entry['outcome'];
    const ticks = int(entry['ticks'], 0);
    const enemySurvivors = int(entry['enemySurvivors'], 0);
    const livesLost = int(entry['livesLost'], 0);
    const goldEarned = int(entry['goldEarned']);
    const rawRelic = entry['relicId'];

    if (
      round === null ||
      encounterId === null ||
      ticks === null ||
      enemySurvivors === null ||
      livesLost === null ||
      goldEarned === null
    ) {
      return null;
    }
    if (outcome !== 'player' && outcome !== 'enemy' && outcome !== 'draw') return null;

    let relicId: string | null = null;
    if (rawRelic !== null) {
      relicId = str(rawRelic);
      if (relicId === null || !data.relics.has(relicId)) return null;
    }

    records.push({
      round,
      encounterId,
      outcome,
      ticks,
      enemySurvivors,
      livesLost,
      goldEarned,
      relicId,
    });
  }

  return records;
}

/**
 * Turns a saved string back into a run.
 *
 * `data` is required because half the validation is cross-referential: a save
 * naming a unit or relic that this build no longer ships has to be rejected,
 * and only the loaded content knows what ships.
 */
export function deserializeRun(raw: string, data: GameData): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'save is not valid JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'save is not an object' };

  const saveVersion = int(parsed['saveVersion'], 1);
  if (saveVersion === null) return { ok: false, reason: 'save has no version' };
  if (saveVersion !== RUN_SAVE_VERSION) {
    return {
      ok: false,
      reason: `save is version ${saveVersion}, this build reads version ${RUN_SAVE_VERSION}`,
    };
  }

  const rules = data.run.rules;
  const seed = int(parsed['seed'], 0);
  const round = int(parsed['round'], 1);
  const lives = int(parsed['lives'], 0);
  const gold = int(parsed['gold'], 0);
  const rerolls = int(parsed['rerolls'], 0);
  const freeRerolls = int(parsed['freeRerolls'], 0);
  const phase = parsed['phase'];

  if (seed === null) return { ok: false, reason: 'seed is missing or not an integer' };
  if (round === null || round > rules.rounds) {
    return { ok: false, reason: `round is missing or past round ${rules.rounds}` };
  }
  if (lives === null) return { ok: false, reason: 'lives is missing or negative' };
  if (gold === null) return { ok: false, reason: 'gold is missing or negative' };
  if (rerolls === null) return { ok: false, reason: 'rerolls is missing or negative' };
  if (freeRerolls === null) {
    return { ok: false, reason: 'freeRerolls is missing or negative' };
  }
  if (typeof phase !== 'string' || !(RUN_PHASES as readonly string[]).includes(phase)) {
    return { ok: false, reason: `unknown phase ${JSON.stringify(phase)}` };
  }

  const board = parseBoard(parsed['board'], data);
  if (board === null) return { ok: false, reason: 'board is malformed' };

  const shop = parseShop(parsed['shop'], data);
  if (shop === null) return { ok: false, reason: 'shop is malformed' };

  const relicIds = strArray(parsed['relicIds']);
  if (relicIds === null) return { ok: false, reason: 'relicIds is malformed' };
  for (const id of relicIds) {
    if (!data.relics.has(id)) {
      return { ok: false, reason: `save holds relic ${JSON.stringify(id)}, which no longer exists` };
    }
  }

  const rawOffer = parsed['rewardOffer'];
  let rewardOffer: string[] | null = null;
  if (rawOffer !== null) {
    rewardOffer = strArray(rawOffer);
    if (rewardOffer === null) return { ok: false, reason: 'rewardOffer is malformed' };
    for (const id of rewardOffer) {
      if (!data.relics.has(id)) {
        return { ok: false, reason: `offered relic ${JSON.stringify(id)} no longer exists` };
      }
    }
  }

  const history = parseHistory(parsed['history'], data);
  if (history === null) return { ok: false, reason: 'history is malformed' };

  const rawResult = parsed['result'];
  if (rawResult !== null && rawResult !== 'victory' && rawResult !== 'defeat') {
    return { ok: false, reason: `unknown result ${JSON.stringify(rawResult)}` };
  }

  // Coherence, not just shape: a save that says "choose a reward" with no offer
  // would leave the player on a screen with no buttons.
  if (phase === 'reward' && (rewardOffer === null || rewardOffer.length === 0)) {
    return { ok: false, reason: 'save is in the reward phase with nothing on offer' };
  }
  if (phase === 'over' && rawResult === null) {
    return { ok: false, reason: 'save says the run is over but not how it ended' };
  }
  if (phase !== 'over' && lives <= 0) {
    return { ok: false, reason: 'save has no lives left but is not over' };
  }

  return {
    ok: true,
    state: {
      saveVersion,
      seed,
      round,
      phase: phase as RunPhase,
      lives,
      gold,
      shop,
      rerolls,
      freeRerolls,
      board,
      relicIds,
      rewardOffer,
      history,
      result: rawResult as RunState['result'],
    },
  };
}

/** Kept honest by a test: every rarity the schema knows has a weight row. */
export const KNOWN_RARITIES: readonly string[] = RELIC_RARITIES;

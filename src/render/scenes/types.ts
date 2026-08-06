/**
 * Scene contract and the transition table.
 *
 * The flow is a state machine written down rather than implied. Every legal
 * move is listed in {@link ALLOWED_TRANSITIONS}, and anything else throws — a
 * scene cannot quietly hand control somewhere it should not, and reading the
 * table tells you the whole flow.
 */

import type { Container } from 'pixi.js';
import type { BattleResult } from '../../core/battle/index';
import type { RunState } from '../../core/run/index';
import type { GameData } from '../../data/schema';
import type { Atlas } from '../atlas';
import type { Layout } from '../layout';
import type { TextureRegistry } from '../textures';

export const SCENE_IDS = ['boot', 'menu', 'run', 'result'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

/**
 * Which scene may hand off to which.
 *
 * `boot` is the entry point and nothing returns to it. `result` can go back to
 * the menu or straight into another run, which is the loop a roguelike lives
 * in.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<SceneId, readonly SceneId[]>> = {
  boot: ['menu'],
  menu: ['run'],
  run: ['result'],
  result: ['menu', 'run'],
};

/** Shared services a scene may use. Built once, at boot. */
export interface SceneContext {
  readonly data: GameData;
  readonly atlas: Atlas;
  readonly textures: TextureRegistry;
  /** Current layout. Re-read on every `resize`. */
  layout: Layout;
  /** Requests a transition. Rejected if the table does not allow it. */
  readonly goTo: (id: SceneId, payload?: ScenePayload) => void;
}

/** What one scene hands the next. */
export interface ScenePayload {
  readonly battle?: BattleResult;
  /** The finished run, handed to `result`. */
  readonly run?: RunState;
  /** Continue the saved run instead of starting a new one. */
  readonly resume?: boolean;
  /** Seed for a fresh run. Omitted means "pick one". */
  readonly seed?: number;
}

export interface Scene {
  readonly id: SceneId;
  /** Display root, added to the stage while the scene is active. */
  readonly view: Container;
  enter(payload: ScenePayload): void;
  exit(): void;
  update(deltaMs: number): void;
  resize(layout: Layout): void;
  destroy(): void;
}

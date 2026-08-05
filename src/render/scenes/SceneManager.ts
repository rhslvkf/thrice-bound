/**
 * The scene state machine.
 *
 * Holds exactly one active scene, and moves between them only along the edges
 * in {@link ALLOWED_TRANSITIONS}. An illegal transition throws rather than
 * being ignored: a scene asking for somewhere it cannot go is a bug in the
 * flow, and a silent no-op would leave the game wedged on a screen with no
 * indication why.
 *
 * Transitions are deferred to the end of the frame. A scene that calls `goTo`
 * from inside its own `update` would otherwise be torn down mid-update, with
 * the rest of that method still to run.
 */

import { Container } from 'pixi.js';
import type { Layout } from '../layout';
import { ALLOWED_TRANSITIONS } from './types';
import type { Scene, SceneId, ScenePayload } from './types';

export class SceneManager {
  readonly root = new Container();

  private readonly scenes = new Map<SceneId, Scene>();
  private active: Scene | null = null;
  private pending: { id: SceneId; payload: ScenePayload } | null = null;
  private layout: Layout;

  constructor(layout: Layout) {
    this.layout = layout;
  }

  register(scene: Scene): void {
    this.scenes.set(scene.id, scene);
    scene.view.visible = false;
    this.root.addChild(scene.view);
  }

  get activeId(): SceneId | null {
    return this.active?.id ?? null;
  }

  /**
   * Queues a transition, applied before the next update.
   *
   * @throws {Error} if the current scene is not allowed to reach `id`, or if
   *   no scene is registered under that id.
   */
  request(id: SceneId, payload: ScenePayload = {}): void {
    const from = this.active?.id;
    if (from !== undefined) {
      const allowed = ALLOWED_TRANSITIONS[from];
      if (!allowed.includes(id)) {
        throw new Error(
          `illegal scene transition ${from} -> ${id}; ${from} may go to ${allowed.join(', ') || 'nowhere'}`,
        );
      }
    }
    if (!this.scenes.has(id)) {
      throw new Error(`no scene registered for ${JSON.stringify(id)}`);
    }
    this.pending = { id, payload };
  }

  /** Enters the first scene. Bypasses the table, having nothing to come from. */
  start(id: SceneId, payload: ScenePayload = {}): void {
    this.pending = { id, payload };
    this.flush();
  }

  update(deltaMs: number): void {
    this.flush();
    this.active?.update(deltaMs);
  }

  resize(layout: Layout): void {
    this.layout = layout;
    for (const scene of this.scenes.values()) scene.resize(layout);
  }

  private flush(): void {
    const next = this.pending;
    if (next === null) return;
    this.pending = null;

    const scene = this.scenes.get(next.id);
    if (scene === undefined) return;

    if (this.active !== null) {
      this.active.exit();
      this.active.view.visible = false;
    }

    this.active = scene;
    // Laid out before it is shown, so a scene never appears at stale
    // coordinates for one frame after a resize.
    scene.resize(this.layout);
    scene.enter(next.payload);
    scene.view.visible = true;
  }

  destroy(): void {
    for (const scene of this.scenes.values()) scene.destroy();
    this.scenes.clear();
    this.active = null;
    this.root.destroy({ children: true });
  }
}

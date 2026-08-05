/**
 * Pool of unit views.
 *
 * The board holds twenty cells, but a battle churns through more than twenty
 * bodies: summons appear, units die and fade. Allocating a view per spawn
 * would mean building a container and nine sprites in the middle of a frame,
 * every time. Views are recycled instead, so after the first battle the pool
 * hands back objects that already exist.
 */

import type { Container } from 'pixi.js';
import type { Atlas } from '../atlas';
import { UnitView } from './UnitView';

export class UnitPool {
  private readonly idle: UnitView[] = [];
  private readonly live = new Map<number, UnitView>();

  constructor(
    private readonly atlas: Atlas,
    private readonly layer: Container,
  ) {}

  /** A view bound to an instance id, creating one only if the pool is empty. */
  acquire(instanceId: number): UnitView {
    const existing = this.live.get(instanceId);
    if (existing !== undefined) return existing;

    const view = this.idle.pop() ?? this.create();
    this.live.set(instanceId, view);
    return view;
  }

  get(instanceId: number): UnitView | undefined {
    return this.live.get(instanceId);
  }

  release(instanceId: number): void {
    const view = this.live.get(instanceId);
    if (view === undefined) return;
    view.release();
    this.live.delete(instanceId);
    this.idle.push(view);
  }

  /** Retires every live view, ready for the next battle. */
  releaseAll(): void {
    for (const [instanceId] of this.live) this.release(instanceId);
  }

  /** Number of views currently on the board, for diagnostics. */
  get liveCount(): number {
    return this.live.size;
  }

  private create(): UnitView {
    const view = new UnitView(this.atlas);
    this.layer.addChild(view.root);
    return view;
  }

  destroy(): void {
    for (const view of this.idle) view.destroy();
    for (const view of this.live.values()) view.destroy();
    this.idle.length = 0;
    this.live.clear();
  }
}

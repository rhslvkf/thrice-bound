/**
 * Particles.
 *
 * A fixed pool of sprites, all drawn from the shared atlas, all in one
 * container. The pool is allocated once at boot and never grows: emitting is
 * finding a dead slot and writing numbers into it, and a burst that would
 * exceed capacity is simply truncated. A particle system that allocates during
 * an explosion is a particle system that stutters during an explosion.
 *
 * Because every particle uses an atlas frame, five hundred of them cost the
 * same number of draw calls as one.
 */

import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { tuning } from './tuning';

/** Simultaneous particles. Beyond this, new emissions are dropped. */
export const PARTICLE_CAPACITY = 500;

interface Particle {
  sprite: Sprite;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  sizeFrom: number;
  sizeTo: number;
  alphaFrom: number;
  alphaTo: number;
  rotation: number;
  spin: number;
  tint: number;
  /** Per-emission gravity multiplier; a ring wave wants none, debris does. */
  gravityScale: number;
}

export interface BurstOptions {
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly texture: Texture;
  readonly tint: number;
  /** Base speed in cells per second; each particle varies around it. */
  readonly speed: number;
  readonly speedJitter?: number;
  readonly lifeMs: number;
  readonly lifeJitter?: number;
  readonly sizeFrom: number;
  readonly sizeTo: number;
  readonly alphaFrom?: number;
  readonly alphaTo?: number;
  readonly spin?: number;
  readonly gravityScale?: number;
  /** Restricts emission to an arc, in radians. Defaults to a full circle. */
  readonly angleFrom?: number;
  readonly angleTo?: number;
}

/** A single expanding ring, used for merge and synergy pulses. */
export interface RingOptions {
  readonly x: number;
  readonly y: number;
  readonly texture: Texture;
  readonly tint: number;
  readonly fromSize: number;
  readonly toSize: number;
  readonly lifeMs: number;
  readonly alphaFrom?: number;
}

export class ParticleSystem {
  readonly root = new Container();
  private readonly particles: Particle[] = [];
  private cursor = 0;
  private liveCount = 0;

  /**
   * @param random Injected so bursts are reproducible when the caller wants
   *   them to be. Presentation only — nothing here touches a battle.
   */
  constructor(
    capacity: number = PARTICLE_CAPACITY,
    private readonly random: () => number = Math.random,
  ) {
    for (let i = 0; i < capacity; i += 1) {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      sprite.visible = false;
      this.root.addChild(sprite);
      this.particles.push({
        sprite,
        alive: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        ageMs: 0,
        lifeMs: 0,
        sizeFrom: 0,
        sizeTo: 0,
        alphaFrom: 1,
        alphaTo: 0,
        rotation: 0,
        spin: 0,
        tint: 0xffffff,
        gravityScale: 1,
      });
    }
  }

  get active(): number {
    return this.liveCount;
  }

  get capacity(): number {
    return this.particles.length;
  }

  /**
   * Emits a burst. `cellSize` converts cell-relative speeds and sizes to
   * pixels, so a burst looks the same on a phone and a monitor.
   */
  burst(options: BurstOptions, cellSize: number): void {
    const from = options.angleFrom ?? 0;
    const to = options.angleTo ?? Math.PI * 2;
    const speedJitter = options.speedJitter ?? 0.45;
    const lifeJitter = options.lifeJitter ?? 0.35;

    for (let i = 0; i < options.count; i += 1) {
      const particle = this.claim();
      if (particle === null) return;

      // Evenly spaced around the arc with a jitter, rather than fully random:
      // a purely random spread clumps, and a clumped burst reads as a smear.
      const angle = from + ((to - from) * (i + this.random() * 0.8)) / options.count;
      const speed = options.speed * cellSize * (1 + (this.random() - 0.5) * speedJitter);

      particle.x = options.x;
      particle.y = options.y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.ageMs = 0;
      particle.lifeMs = options.lifeMs * (1 + (this.random() - 0.5) * lifeJitter);
      particle.sizeFrom = options.sizeFrom * cellSize;
      particle.sizeTo = options.sizeTo * cellSize;
      particle.alphaFrom = options.alphaFrom ?? 1;
      particle.alphaTo = options.alphaTo ?? 0;
      particle.rotation = this.random() * Math.PI * 2;
      particle.spin = (options.spin ?? 0) * (this.random() - 0.5) * 2;
      particle.tint = options.tint;
      particle.gravityScale = options.gravityScale ?? 1;

      particle.sprite.texture = options.texture;
      particle.sprite.tint = options.tint;
      particle.sprite.visible = true;
    }
  }

  /** Emits one stationary, expanding ring. */
  ring(options: RingOptions, cellSize: number): void {
    const particle = this.claim();
    if (particle === null) return;

    particle.x = options.x;
    particle.y = options.y;
    particle.vx = 0;
    particle.vy = 0;
    particle.ageMs = 0;
    particle.lifeMs = options.lifeMs;
    particle.sizeFrom = options.fromSize * cellSize;
    particle.sizeTo = options.toSize * cellSize;
    particle.alphaFrom = options.alphaFrom ?? 0.85;
    particle.alphaTo = 0;
    particle.rotation = 0;
    particle.spin = 0;
    particle.tint = options.tint;
    particle.gravityScale = 0;

    particle.sprite.texture = options.texture;
    particle.sprite.tint = options.tint;
    particle.sprite.visible = true;
  }

  /**
   * Advances every live particle.
   *
   * Fed scaled time, so particles hang in the air during a hitstop instead of
   * sailing on through the freeze.
   */
  update(deltaMs: number, cellSize: number): void {
    if (this.liveCount === 0) return;
    const seconds = deltaMs / 1000;
    const gravity = tuning.particles.gravity * cellSize;
    const drag = Math.max(0, 1 - tuning.particles.drag * seconds);

    for (const particle of this.particles) {
      if (!particle.alive) continue;

      particle.ageMs += deltaMs;
      if (particle.ageMs >= particle.lifeMs) {
        particle.alive = false;
        particle.sprite.visible = false;
        this.liveCount -= 1;
        continue;
      }

      particle.vy += gravity * particle.gravityScale * seconds;
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.rotation += particle.spin * seconds;

      const t = particle.ageMs / particle.lifeMs;
      const size = particle.sizeFrom + (particle.sizeTo - particle.sizeFrom) * t;

      const sprite = particle.sprite;
      sprite.position.set(particle.x, particle.y);
      sprite.width = size;
      sprite.height = size;
      sprite.rotation = particle.rotation;
      sprite.alpha = particle.alphaFrom + (particle.alphaTo - particle.alphaFrom) * t;
    }
  }

  /** Kills everything, e.g. when leaving a scene. */
  clear(): void {
    for (const particle of this.particles) {
      particle.alive = false;
      particle.sprite.visible = false;
    }
    this.liveCount = 0;
  }

  /**
   * Finds a free slot.
   *
   * Sweeps from where it left off rather than from zero, so filling the pool
   * stays linear overall instead of rescanning the live prefix every time.
   * Returns `null` when full — a dropped particle is always better than a
   * dropped frame.
   */
  private claim(): Particle | null {
    const total = this.particles.length;
    if (this.liveCount >= total) return null;

    for (let i = 0; i < total; i += 1) {
      const index = (this.cursor + i) % total;
      const particle = this.particles[index];
      if (particle !== undefined && !particle.alive) {
        this.cursor = (index + 1) % total;
        particle.alive = true;
        this.liveCount += 1;
        return particle;
      }
    }
    return null;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/**
 * Resolving a unit's `artKey` to something drawable.
 *
 * No art exists yet, so every unit currently falls back to a tier-coded
 * placeholder shape. The point of routing through here is that the fallback is
 * the *only* thing that has to change when art arrives: drop a texture into
 * the loaded set under its `artKey` and every unit using that key starts
 * drawing it, with no change to `UnitView` or any scene.
 *
 * The two cases differ in one visible way, handled here so callers do not have
 * to care: a placeholder is a white silhouette that must be tinted to mean
 * anything, while real art carries its own colour and must not be.
 */

import { Assets, Texture } from 'pixi.js';
import type { UnitDef } from '../data/schema';
import type { Atlas } from './atlas';
import { MAX_TIER, MIN_TIER } from '../data/schema';

export interface UnitArt {
  readonly texture: Texture;
  /**
   * `true` when the texture is a white silhouette expecting a team tint.
   * Real art is drawn untinted.
   */
  readonly tintable: boolean;
}

export class TextureRegistry {
  private readonly cache = new Map<string, UnitArt>();

  constructor(private readonly atlas: Atlas) {}

  /**
   * Art for a unit definition.
   *
   * Looks for a real texture registered under the unit's `artKey` first;
   * falls back to the placeholder shape for its tier.
   */
  resolve(def: UnitDef): UnitArt {
    const cached = this.cache.get(def.artKey);
    if (cached !== undefined) return cached;

    const art: UnitArt = this.lookupLoaded(def.artKey) ?? {
      texture: this.placeholderFor(def.tier),
      tintable: true,
    };
    this.cache.set(def.artKey, art);
    return art;
  }

  /**
   * A texture already in PixiJS's asset cache under this key, if any.
   *
   * `Assets.get` throws for unknown keys in some versions and returns
   * `undefined` in others, so both are treated as "not loaded yet".
   */
  private lookupLoaded(artKey: string): UnitArt | null {
    try {
      const loaded: unknown = Assets.get(artKey);
      if (loaded instanceof Texture) return { texture: loaded, tintable: false };
    } catch {
      // Not loaded. Placeholder it is.
    }
    return null;
  }

  private placeholderFor(tier: number): Texture {
    const clamped = Math.min(MAX_TIER, Math.max(MIN_TIER, Math.round(tier)));
    const shape = this.atlas.shapes[clamped];
    if (shape === undefined) {
      throw new Error(`no placeholder shape for tier ${tier}`);
    }
    return shape;
  }

  /**
   * Drops cached lookups so newly loaded art is picked up.
   *
   * Call after loading an asset bundle. Existing `UnitView`s re-resolve when
   * they are next bound to a unit, which happens every battle.
   */
  invalidate(): void {
    this.cache.clear();
  }
}

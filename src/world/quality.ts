import type { Tier } from '../render/quality';

/** Per-tier settings for the Valley's world: distances, densities, shadows, reflections and texture sizes. */
export type WorldQuality = { viewDistance: number; treeDensity: number; shrubDensity: number; grassRadius: number; grassDensity: number;
  cascades: number; shadowMap: number; shadowFar: number; reflections: 'planar' | 'sky'; impostorSize: number; textureSize: 1024 | 2048;
  nearTree: number; midTree: number; nearShrub: number; midShrub: number; shrubCull: number; propCull: number; minScale: number /*dynamic resolution floor*/ };

/**
 * The Valley's quality tiers. Density thinning is deterministic: an instance is drawn when
 * `fract(tint · 43758.5453 + index · 0.618) < density`.
 */
export const WORLD_QUALITY: Record<Tier, WorldQuality> = {
  high:   { viewDistance: 2400, treeDensity: 1,   shrubDensity: 1,   grassRadius: 60, grassDensity: 1,   cascades: 4, shadowMap: 2048, shadowFar: 600, reflections: 'planar', impostorSize: 256, textureSize: 2048, nearTree: 60, midTree: 220, nearShrub: 40, midShrub: 120, shrubCull: 180, propCull: 300, minScale: 0.7 },
  medium: { viewDistance: 1600, treeDensity: 0.7, shrubDensity: 0.5, grassRadius: 40, grassDensity: 0.6, cascades: 3, shadowMap: 1024, shadowFar: 400, reflections: 'sky',    impostorSize: 128, textureSize: 1024, nearTree: 45, midTree: 160, nearShrub: 30, midShrub: 80,  shrubCull: 120, propCull: 200, minScale: 0.7 },
  low:    { viewDistance: 1000, treeDensity: 0.45,shrubDensity: 0.25,grassRadius: 25, grassDensity: 0.35,cascades: 2, shadowMap: 1024, shadowFar: 250, reflections: 'sky',    impostorSize: 128, textureSize: 1024, nearTree: 30, midTree: 110, nearShrub: 20, midShrub: 50,  shrubCull: 70,  propCull: 120, minScale: 0.6 },
};

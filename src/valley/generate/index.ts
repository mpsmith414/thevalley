/** The whole generation pipeline: terrain, water, biomes, then plants. Pure and deterministic (same layout and version give the same data). */
import { hash } from '../../util/hash';
import { buildAllPlants } from '../../plants/generator';
import { scatterAll } from '../../plants/scatter';
import { DEFAULT_GRID, GENERATOR_VERSION, type Layout, type ValleyData } from '../types';
import { createValley } from '../valley';
import { baseShape } from './shape';
import { erode } from './erosion';
import { carveWater } from './carve';
import { computeBiomes, computeNormals } from './biomes';

export type GenStage = 'shape' | 'erode' | 'carve' | 'biomes' | 'scatter' | 'plants';

/** The cache key: changes with the layout, the grid size and the generator version. */
export const cacheKey = (layout: Layout, grid: number, version = GENERATOR_VERSION) => hash({ layout, grid, v: version });

/** Build the whole Valley. `onProgress` is called with frac 0 at the start and 1 at the end of each stage. */
export function generateValley(
  layout: Layout,
  opts: { grid?: number; onProgress?: (stage: GenStage, frac: number) => void } = {},
): ValleyData {
  const grid = opts.grid ?? DEFAULT_GRID, say = opts.onProgress ?? (() => {});
  const stage = <T>(s: GenStage, f: () => T): T => { say(s, 0); const r = f(); say(s, 1); return r; };

  const g = stage('shape', () => baseShape(layout, grid));
  stage('erode', () => erode(g, layout.seed));
  const { river, water } = stage('carve', () => carveWater(g, layout));
  const { biomes, normals } = stage('biomes', () => ({ biomes: computeBiomes(g, water, layout), normals: computeNormals(g) }));
  const data: ValleyData = {
    version: GENERATOR_VERSION, key: cacheKey(layout, grid), size: g.size, grid, height: g.h, normals, water, biomes, river, tiles: [], plantModels: [],
  };
  const valley = createValley(data);
  data.tiles = stage('scatter', () => scatterAll(valley, layout.seed));
  data.plantModels = stage('plants', () => buildAllPlants(layout.seed));
  return data;
}

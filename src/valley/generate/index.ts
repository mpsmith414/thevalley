/** The whole generation pipeline: terrain, water, biomes, then plants. Pure and deterministic (same layout and version give the same data). */
import { buildAllPlants } from '../../plants/generator';
import { scatterAll } from '../../plants/scatter';
import { cacheKey } from '../key';
import { DEFAULT_GRID, GENERATOR_VERSION, type Layout, type ValleyData } from '../types';
import { createValley } from '../valley';
import { baseShape } from './shape';
import { erode } from './erosion';
import { carveWater } from './carve';
import { computeBiomes, computeNormals } from './biomes';

export type GenStage = 'shape' | 'erode' | 'carve' | 'biomes' | 'scatter' | 'plants';

export { cacheKey };

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

import { VALLEY } from '../../src/valley/layout';
import { GENERATOR_VERSION, type ValleyData } from '../../src/valley/types';
import { baseShape } from '../../src/valley/generate/shape';
import { erode } from '../../src/valley/generate/erosion';
import { carveWater } from '../../src/valley/generate/carve';
import { computeBiomes, computeNormals } from '../../src/valley/generate/biomes';

const cache = new Map<number, ValleyData>();

/** A small Valley (shape, erosion, water, biomes, normals; no plants) for tests. Memoised per grid size. */
export function smallValleyData(grid = 513): ValleyData {
  let d = cache.get(grid);
  if (!d) {
    const g = baseShape(VALLEY, grid);
    erode(g, VALLEY.seed);
    const { river, water } = carveWater(g, VALLEY);
    d = {
      version: GENERATOR_VERSION, key: 'test', size: g.size, grid, height: g.h, normals: computeNormals(g),
      water, biomes: computeBiomes(g, water, VALLEY), river, tiles: [], plantModels: [],
    };
    cache.set(grid, d);
  }
  return d;
}

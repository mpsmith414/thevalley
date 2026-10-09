import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { biped, bird, blob, hexapod, quadruped, snake } from '../fixtures/recipes';

/** Number of connected components of a triangle mesh (vertices joined by shared triangles). */
function components(indices: Uint32Array, vertexCount: number): number {
  const p = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (x: number): number => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
  for (let t = 0; t < indices.length; t += 3) { p[find(indices[t])] = find(indices[t + 1]); p[find(indices[t + 1])] = find(indices[t + 2]); }
  return new Set(Array.from(indices, find)).size; // only vertices a triangle uses count
}

describe('connected bodies', () => {
  for (const recipe of [...CAST.map((c) => c.recipe), quadruped, snake, hexapod, blob, biped, bird])
    it(`${recipe.name} meshes as one piece at LOD0 (no carve or feature severs a part)`, () => {
      const m = buildBody(recipe, [0]).lods[0];
      expect(components(m.indices, m.positions.length / 3)).toBe(1);
    }, 60_000);
});

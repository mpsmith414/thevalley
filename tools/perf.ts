/** Body build times and triangle counts for every native animal and fixture recipe: npx tsx tools/perf.ts */
import { buildBody } from '../src/builder/build';
import { CAST } from '../src/cast';
import { biped, bird, blob, hexapod, quadruped, snake } from '../tests/fixtures/recipes';

const fixtures = [quadruped, snake, hexapod, blob, biped, bird];
const all = [...CAST.map((c) => c.recipe), ...fixtures];

buildBody(CAST[0].recipe, [2]); // warm up
for (const recipe of all) {
  const t0 = performance.now();
  const lod0 = buildBody(recipe, [0]);
  const t1 = performance.now();
  const full = buildBody(recipe, [0, 1, 2]);
  const t2 = performance.now();
  const tris = full.lods.map((l) => l.indices.length / 3).join(' / ');
  console.log(`${recipe.name.padEnd(10)} LOD0 ${(t1 - t0).toFixed(0).padStart(5)} ms (${lod0.lods[0].positions.length / 3} vertices) · all three ${(t2 - t1).toFixed(0).padStart(5)} ms · triangles ${tris}`);
}

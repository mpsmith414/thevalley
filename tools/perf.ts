/** Body build times for every native animal: npx tsx tools/perf.ts */
import { buildBody } from '../src/builder/build';
import { CAST } from '../src/cast';

buildBody(CAST[0].recipe, [2]); // warm up
for (const { recipe } of CAST) {
  const t0 = performance.now();
  const lod0 = buildBody(recipe, [0]);
  const t1 = performance.now();
  buildBody(recipe, [0, 1, 2]);
  const t2 = performance.now();
  console.log(`${recipe.name.padEnd(8)} LOD0 ${(t1 - t0).toFixed(0).padStart(5)} ms (${lod0.lods[0].positions.length / 3} vertices) · all three ${(t2 - t1).toFixed(0).padStart(5)} ms`);
}

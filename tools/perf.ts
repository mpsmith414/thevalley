/** Body build times and triangle counts for every native animal and fixture recipe: npx tsx tools/perf.ts */
import { buildBody, type BuildTimes } from '../src/builder/build';
import { CAST } from '../src/cast';
import { biped, bird, blob, hexapod, quadruped, snake } from '../tests/fixtures/recipes';

const fixtures = [quadruped, snake, hexapod, blob, biped, bird];
const all = [...CAST.map((c) => c.recipe), ...fixtures];
const ms = (n: number) => n.toFixed(0).padStart(5);

buildBody(CAST[0].recipe, [2]); // warm up
for (const recipe of all) {
  const t0 = performance.now();
  const lod0 = buildBody(recipe, [0]);
  const t1 = performance.now();
  const times: BuildTimes = { sample: 0, mesh: 0, weigh: 0, simplify: 0, snap: 0, skin: 0, rawVertices: 0, maxSnap: 0 };
  const full = buildBody(recipe, [0, 1, 2], times);
  const t2 = performance.now();
  const tris = full.lods.map((l) => l.indices.length / 3).join(' / ');
  console.log(`${recipe.name.padEnd(10)} LOD0 ${ms(t1 - t0)} ms (${lod0.lods[0].positions.length / 3} vertices) · all three ${ms(t2 - t1)} ms · triangles ${tris}`);
  const { sample, mesh, weigh, simplify, snap, skin, rawVertices } = times;
  console.log(`${''.padEnd(10)} raw ${rawVertices} vertices · sample ${ms(sample)} · mesh ${ms(mesh)} · weigh ${ms(weigh)} · simplify ${ms(simplify)} · snap+normals ${ms(snap)} · skin ${ms(skin)} ms`);
}

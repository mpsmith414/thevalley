/** Valley generation time per stage, plant counts and data size: npx tsx tools/valley-perf.ts [grid] */
import { generateValley, type GenStage } from '../src/valley/generate';
import { VALLEY } from '../src/valley/layout';
import { DEFAULT_GRID } from '../src/valley/types';
import { PLANT_KINDS } from '../src/plants/species';
import { transferables } from '../src/valley/transfer';

const grid = Number(process.argv[2]) || DEFAULT_GRID;
const ms: Partial<Record<GenStage, number>> = {};
let t0 = performance.now(), start = t0;
const data = generateValley(VALLEY, {
  grid,
  onProgress: (stage, frac) => {
    const now = performance.now();
    if (frac === 0) t0 = now;
    else ms[stage] = now - t0;
  },
});
const total = performance.now() - start;

console.log(`grid ${grid}`);
for (const [stage, t] of Object.entries(ms)) console.log(`${stage.padEnd(8)} ${t.toFixed(0).padStart(7)} ms`);
console.log(`${'total'.padEnd(8)} ${total.toFixed(0).padStart(7)} ms${total < 12000 ? '' : '  (OVER the 12 s budget)'}`);

const counts = new Array<number>(PLANT_KINDS.length).fill(0);
for (const t of data.tiles) for (const k of t.plants.kind) counts[k]++;
console.log('instances:', PLANT_KINDS.map((k, i) => `${k} ${counts[i]}`).join(', '), `(total ${counts.reduce((a, b) => a + b, 0)})`);

const bytes = transferables(data).reduce((s, b) => s + b.byteLength, 0);
console.log(`ValleyData typed arrays: ${(bytes / 1048576).toFixed(1)} MiB`);

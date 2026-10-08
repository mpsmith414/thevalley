/** The plant generator: turns a species recipe, variant and seed into near (LOD0) and mid (LOD1) geometry. */
import { mulberry32, between } from '../util/rng';
import { hash } from '../util/hash';
import { PLANT_KINDS, SPECIES, VARIANTS, type PlantKind, type PlantSpec } from './species';
import { buildTree } from './forms/tree';
import { buildShrub } from './forms/shrub';
import { buildFern } from './forms/fern';
import { buildRock } from './forms/rock';
import { buildLog, buildStump } from './forms/log';

export type PlantMesh = {
  positions: Float32Array; normals: Float32Array; uvs: Float32Array;
  info: Float32Array /*vec4: windWeight 0 base…1 tips, branchLevel, isLeaf 0|1, ao*/; indices: Uint32Array;
  groups: { start: number; count: number; material: 'bark' | 'leaf' | 'rock' }[];
};
/** One model: two LODs, its height (top of LOD0) and radius (furthest LOD0 vertex from the y axis), in metres. */
export type PlantModel = { kind: PlantKind; variant: number; lods: [PlantMesh, PlantMesh]; height: number; radius: number };
/** Every model; index = PLANT_KINDS.indexOf(kind) * VARIANTS + variant. */
export type PlantModelSet = PlantModel[];

/** Triangle budget per form: [LOD0, LOD1]. */
export const TRI_BUDGET: Record<PlantSpec['form'], [number, number]> =
  { tree: [12000, 2500], shrub: [3000, 600], fern: [2000, 400], rock: [2000, 300], log: [1500, 300], stump: [800, 200] };

/** Scales positions about the origin so LOD0's top sits exactly at `h`. */
function fitHeight(lods: [PlantMesh, PlantMesh], h: number) {
  const k = h / top(lods[0]);
  for (const l of lods) for (let i = 0; i < l.positions.length; i++) l.positions[i] *= k;
}
function top(m: PlantMesh) {
  let y = -Infinity;
  for (let i = 1; i < m.positions.length; i += 3) y = Math.max(y, m.positions[i]);
  return y;
}

/**
 * One model. Variants 0–1 are young (living plants 45–60% of a random full size, with fewer branches; props from the
 * small end of their range); variants 2–5 are mature, spread evenly over the size range.
 */
export function buildPlant(kind: PlantKind, variant: number, seed: number): PlantModel {
  const rng = mulberry32(parseInt(hash([seed, kind, variant]), 16)), s = SPECIES[kind].spec, young = variant < 2;
  const t = young ? rng() : (variant - 2 + rng()) / (VARIANTS - 2);
  const live = ([lo, hi]: [number, number]) => (lo + (hi - lo) * t) * (young ? between(rng, 0.45, 0.6) : 1);
  const prop = ([lo, hi]: [number, number]) => lo + (hi - lo) * (young ? 0.25 * t : t);
  let lods: [PlantMesh, PlantMesh];
  switch (s.form) {
    case 'tree': case 'shrub': {
      const h = live(s.height);
      lods = s.form === 'tree' ? buildTree(s, rng, h, young, TRI_BUDGET.tree) : buildShrub(s, rng, h, young, TRI_BUDGET.shrub);
      fitHeight(lods, h);
      break;
    }
    case 'fern': lods = buildFern(s, rng, live(s.length), young); break;
    case 'rock': lods = buildRock(s, rng, prop(s.size)); break;
    case 'log': lods = buildLog(s, rng, prop(s.length), prop(s.radius)); break;
    case 'stump': {
      const h = prop(s.height);
      lods = buildStump(s, rng, h, prop(s.radius));
      fitHeight(lods, h); // the lean lifts one side of the top ring a little
      break;
    }
  }
  const p = lods[0].positions;
  let radius = 0;
  for (let i = 0; i < p.length; i += 3) radius = Math.max(radius, Math.hypot(p[i], p[i + 2]));
  return { kind, variant, lods, height: top(lods[0]), radius };
}

/** All `PLANT_KINDS.length × VARIANTS` models, in index order. */
export function buildAllPlants(seed: number): PlantModelSet {
  return PLANT_KINDS.flatMap((kind) => Array.from({ length: VARIANTS }, (_, v) => buildPlant(kind, v, seed)));
}

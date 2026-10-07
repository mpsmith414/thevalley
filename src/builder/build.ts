import type { Recipe } from '../recipe/schema';
import { hash } from '../util/hash';
import { mulberry32 } from '../util/rng';
import { surfaceNets, type MeshData } from './mesher';
import { bodySdf } from './sdf';
import { buildSkeleton, type Skeleton } from './skeleton';
import { skinWeights } from './weights';

/** Grid cells along the creature's longest dimension, per level of detail. */
export const LOD_CELLS = [110, 56, 28] as const;

export type LodMesh = MeshData & { skinIndex: Uint16Array; skinWeight: Float32Array; region: Float32Array; partT: Float32Array; partS: Float32Array; boneOf: Uint16Array };
export type BodyData = { key: string; skeleton: Skeleton; regions: string[]; lods: LodMesh[] };

/** The key that decides whether two recipes share a body (shape and region layout only). */
export const bodyKey = (recipe: Recipe) => hash(recipe.parts) + hash(recipe.skin.regions.map((r) => r.id));

/** Recipe → a skinned body at each level of detail. Pure and deterministic. */
export function buildBody(recipe: Recipe, lods: readonly number[] = [0, 1, 2]): BodyData {
  const skeleton = buildSkeleton(recipe);
  const regions = recipe.skin.regions.map((r) => r.id);
  const sdf = bodySdf(skeleton);
  const { min, max } = skeleton;
  const longest = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
  const meshes = lods.map((l) => {
    const mesh = surfaceNets(sdf, min, max, longest / LOD_CELLS[l]);
    const skin = skinWeights(mesh.positions, skeleton, regions);
    return { ...mesh, skinIndex: skin.skinIndex, skinWeight: skin.skinWeight, region: skin.region, partT: skin.partT, partS: skin.partS, boneOf: skin.boneOf };
  });
  return { key: bodyKey(recipe), skeleton, regions, lods: meshes };
}

export type Variation = { boneScale: number[]; tint: { h: number; s: number; l: number } };

/**
 * How one individual differs from its species, with no rebuild: a size (from the
 * life.sizeM inheritance spread), a small per-part length jitter shared by mirrored
 * pairs, and a slight colour shift. Seed 0 is the species' own look.
 */
export function individualVariation(recipe: Recipe, seed: number, boneCount: number, partOfBone: string[]): Variation {
  if (seed === 0) return { boneScale: new Array(boneCount).fill(1), tint: { h: 0, s: 0, l: 0 } };
  const rng = mulberry32(seed);
  const spread = recipe.inheritance.find((t) => t.path === 'life.sizeM')?.spread ?? 0;
  const size = 1 + (rng() * 2 - 1) * spread;
  const jitter = new Map<string, number>();
  for (const p of recipe.parts) jitter.set(p.id, 1 + (rng() * 2 - 1) * spread * 0.5);
  const tint = { h: (rng() * 2 - 1) * 0.02, s: (rng() * 2 - 1) * 0.05, l: (rng() * 2 - 1) * 0.05 };
  return { boneScale: partOfBone.map((id) => size * (jitter.get(id) ?? 1)), tint };
}

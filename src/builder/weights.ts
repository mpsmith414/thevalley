import { dot, sub } from '../util/vec';
import { boneSdf, thinAxis } from './sdf';
import type { Skeleton } from './skeleton';

export type SkinData = {
  skinIndex: Uint16Array; // 4 per vertex
  skinWeight: Float32Array; // 4 per vertex, summing to 1
  region: Float32Array; // index into the region list, per vertex
  partT: Float32Array; // 0..1 along the nearest bone, per vertex
  partS: Float32Array; // metres along the nearest bone, per vertex
  boneOf: Uint16Array; // nearest bone, per vertex
};

/**
 * Attach each vertex to the bones whose surfaces are nearly as close as the nearest one.
 * Weights fall off over a band of half the nearest bone's radius, so joints bend smoothly
 * while the middle of a limb follows only its own bone.
 */
export function skinWeights(positions: Float32Array, sk: Skeleton, regions: string[]): SkinData {
  const n = positions.length / 3;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const region = new Float32Array(n);
  const partT = new Float32Array(n);
  const partS = new Float32Array(n);
  const boneOf = new Uint16Array(n);
  const bones = sk.bones.map((b, i) => ({ b, i, thin: thinAxis(b) })).filter((x) => x.b.role !== 'eye');
  const regionIndex = new Map(regions.map((r, i) => [r, i]));
  const s = new Float64Array(sk.bones.length);
  const order: number[] = [];

  for (let v = 0; v < n; v++) {
    const p = { x: positions[v * 3], y: positions[v * 3 + 1], z: positions[v * 3 + 2] };
    let best = -1;
    for (const { b, i, thin } of bones) {
      s[i] = boneSdf(p, b, thin);
      if (best < 0 || s[i] < s[best]) best = i;
    }
    const nb = sk.bones[best];
    const band = 0.5 * Math.max(nb.r0, nb.r1);
    order.length = 0;
    for (const { i } of bones) if (s[i] < s[best] + band) order.push(i);
    order.sort((a, b) => s[a] - s[b]);
    let total = 0;
    const w = [0, 0, 0, 0];
    for (let k = 0; k < Math.min(4, order.length); k++) {
      const f = 1 - (s[order[k]] - s[best]) / band;
      w[k] = f * f;
      total += w[k];
    }
    for (let k = 0; k < 4; k++) {
      skinIndex[v * 4 + k] = k < order.length ? order[k] : 0;
      skinWeight[v * 4 + k] = w[k] / total;
    }
    boneOf[v] = best;
    region[v] = regionIndex.get(nb.region) ?? 0;
    const ab = sub(nb.end, nb.start);
    const l2 = dot(ab, ab);
    partT[v] = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, nb.start), ab) / l2)) : 0;
    partS[v] = partT[v] * Math.sqrt(l2);
  }
  return { skinIndex, skinWeight, region, partT, partS, boneOf };
}

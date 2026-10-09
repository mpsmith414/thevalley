import type { LodMesh } from '../../src/builder/build';

/** The weight vertex `v` gives the jaw bone (0 when it has none). */
export function jawWeight(lod: Pick<LodMesh, 'skinIndex' | 'skinWeight'>, jaw: number, v: number): number {
  let w = 0;
  for (let k = 0; k < 4; k++) if (lod.skinIndex[v * 4 + k] === jaw && jaw >= 0) w += lod.skinWeight[v * 4 + k];
  return w;
}

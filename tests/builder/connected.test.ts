import { describe, expect, it } from 'vitest';
import { buildBody } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { dot, sub } from '../../src/util/vec';
import { jawWeight } from '../fixtures/jaw';
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
    it(`${recipe.name} meshes as one piece at LOD0 (no carve or feature severs a part), the jaw only below the slit`, () => {
      const body = buildBody(recipe, [0]), m = body.lods[0], P = m.positions, jaw = body.skeleton.jaw, mf = body.mouth;
      expect(components(m.indices, P.length / 3)).toBe(1);
      // the jaw (skinning, not topology) never reaches above the slit: opening the mouth tears nothing off the head
      expect(jaw >= 0).toBe(mf !== null);
      if (!mf) return;
      for (let v = 0; v < P.length / 3; v++) {
        if (dot(sub({ x: P[v * 3], y: P[v * 3 + 1], z: P[v * 3 + 2] }, mf.hinge), mf.up) > 2 * mf.halfThick) expect(jawWeight(m, jaw, v)).toBe(0);
        expect(m.skinWeight[v * 4] + m.skinWeight[v * 4 + 1] + m.skinWeight[v * 4 + 2] + m.skinWeight[v * 4 + 3]).toBeCloseTo(1, 5);
      }
      // nor tears it open elsewhere: along no edge does the jaw's pull jump so much that opening the mouth 0.4 rad would
      // stretch the edge by more than a quarter of the head's radius (a head-only jaw tore the rabbit's chin off its chest)
      const H = body.skeleton.bones[mf.head], rH = Math.max(H.r0, H.r1), I = m.indices;
      const arm = (v: number) => { const q = sub({ x: P[v * 3], y: P[v * 3 + 1], z: P[v * 3 + 2] }, mf.hinge); return Math.hypot(dot(q, mf.forward), dot(q, mf.up)); };
      let worst = 0;
      for (let t = 0; t < I.length; t += 3)
        for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]])
          worst = Math.max(worst, 0.4 * Math.abs(jawWeight(m, jaw, a) - jawWeight(m, jaw, b)) * Math.max(arm(a), arm(b)));
      expect(worst / rH).toBeLessThan(0.25);
    }, 60_000);
});

/** Boulders: a subdivided icosahedron displaced by fbm, cut by a few facet planes, squashed and flattened underneath. */
import { type Vec3, v3, add, sub, scale, dot, cross, norm } from '../../util/vec';
import { between } from '../../util/rng';
import { createNoise2D, fbm } from '../../valley/generate/noise';
import type { RockSpec } from '../species';
import type { PlantMesh } from '../generator';
import { MeshBuilder } from '../mesh';

/** Unit icosphere: the icosahedron with each triangle split into four `detail` times (shared vertices). */
export function icosphere(detail: number): { v: Vec3[]; f: number[] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(([x, y, z]) => norm(v3(x, y, z)));
  let f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let d = 0; d < detail; d++) {
    const mid = new Map<number, number>(), next: number[] = [];
    const m = (a: number, b: number) => {
      const k = a < b ? a * 65536 + b : b * 65536 + a;
      let i = mid.get(k);
      if (i === undefined) mid.set(k, (i = v.push(norm(add(v[a], v[b]))) - 1));
      return i;
    };
    for (let i = 0; i < f.length; i += 3) {
      const [a, b, c] = [f[i], f[i + 1], f[i + 2]], ab = m(a, b), bc = m(b, c), ca = m(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    f = next;
  }
  return { v, f };
}

/** Both LODs of a boulder `size` m across: detail 3 (1280 triangles) and detail 1 (80), same shape. */
export function buildRock(s: RockSpec, rng: () => number, size: number): [PlantMesh, PlantMesh] {
  const n1 = createNoise2D(Math.floor(rng() * 2 ** 32)), n2 = createNoise2D(Math.floor(rng() * 2 ** 32)), half = size / 2;
  const planes = Array.from({ length: 3 + Math.floor(rng() * 3) }, () => {
    const a = rng() * 2 * Math.PI, y = between(rng, -0.2, 0.9), r = Math.sqrt(1 - y * y);
    return { n: v3(r * Math.cos(a), y, r * Math.sin(a)), d: between(rng, 0.62, 0.85) * half };
  });
  // Three-axis fbm from two 2D noises: smooth over the sphere, lumpy at low frequency, rough at high.
  const shape = (q: Vec3): Vec3 => {
    const lump = 0.5 * (fbm(n1, q.x * 1.2 + 5, q.z * 1.2 + q.y * 0.7, 3) + fbm(n2, q.y * 1.2 + 9, q.x * 1.2 - q.z * 0.7, 3));
    const grain = fbm(n1, q.x * 5 + 31, q.y * 5 - q.z * 3, 3);
    let p = scale(q, half * (1 + 0.25 * lump + 0.12 * s.roughness * grain));
    for (const pl of planes) p = sub(p, scale(pl.n, Math.max(0, dot(p, pl.n) - pl.d) * 0.9));
    return v3(p.x, p.y * s.flatten, p.z);
  };
  // The bottom third (measured on the LOD0 shape, shared by LOD1) is squashed flat and slightly buried.
  let y0 = Infinity, y1 = -Infinity;
  const fine = icosphere(3), fineP = fine.v.map(shape);
  for (const p of fineP) (y0 = Math.min(y0, p.y)), (y1 = Math.max(y1, p.y));
  const cut = y0 + (y1 - y0) / 3, sink = 0.03 * size;
  const lod = (detail: number) => {
    const { v, f } = detail === 3 ? fine : icosphere(detail), ps = detail === 3 ? fineP : v.map(shape);
    for (const p of ps) p.y = (p.y < cut ? cut - (cut - p.y) * 0.15 : p.y) - cut - sink;
    const nrm = ps.map(() => v3());
    for (let i = 0; i < f.length; i += 3) {
      const [a, b, c] = [f[i], f[i + 1], f[i + 2]], fn = cross(sub(ps[b], ps[a]), sub(ps[c], ps[a]));
      for (const k of [a, b, c]) nrm[k] = add(nrm[k], fn);
    }
    const mb = new MeshBuilder(), top = y1 - cut - sink;
    mb.begin('rock');
    v.forEach((q, i) => {
      const u = 0.5 + Math.atan2(q.z, q.x) / (2 * Math.PI), w = 0.5 + Math.asin(Math.max(-1, Math.min(1, q.y))) / Math.PI;
      mb.vert(ps[i], norm(nrm[i], q), u, w, [0, 0, 0, 0.55 + 0.45 * Math.min(1, Math.max(0, ps[i].y / top))]);
    });
    for (let i = 0; i < f.length; i += 3) mb.tri(f[i], f[i + 1], f[i + 2]);
    return mb.build();
  };
  return [lod(3), lod(1)];
}

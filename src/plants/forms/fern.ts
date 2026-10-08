/** Ferns: arched fronds, each a tapering strip of quads (folded into a shallow V at LOD0) mapped with the fern card. */
import { type Vec3, v3, add, scale, cross, norm } from '../../util/vec';
import { between } from '../../util/rng';
import type { FernSpec } from '../species';
import type { PlantMesh } from '../generator';
import { MeshBuilder, crown } from '../mesh';

const DEG = Math.PI / 180, UP = v3(0, 1, 0);
type Frond = { rows: { c: Vec3; side: Vec3; up: Vec3; w: number }[] };

/** Both LODs of a fern with fronds about `length` m long. LOD0: 12 rows, V-folded; LOD1: 4 rows, flat. */
export function buildFern(s: FernSpec, rng: () => number, length: number, young: boolean): [PlantMesh, PlantMesh] {
  const n = young ? 5 + Math.floor(rng() * 3) : 6 + Math.floor(rng() * (s.fronds - 5));
  const fronds = (segs: number, all: { az: number; l: number; e0: number; roll: number }[]): Frond[] =>
    all.map(({ az, l, e0, roll }) => {
      let p = v3(0.03 * Math.cos(az), -0.02, 0.03 * Math.sin(az));
      const rows: Frond['rows'] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs, e = e0 - s.arch * (e0 + 40 * DEG) * Math.pow(t, 1.5);
        const d = v3(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az));
        const side = norm(cross(d, UP)), up = norm(cross(side, d)), r = roll * t;
        const sideR = add(scale(side, Math.cos(r)), scale(up, Math.sin(r))), upR = norm(cross(sideR, d));
        rows.push({ c: p, side: sideR, up: upR, w: l * 0.3 * Math.pow(Math.sin(Math.PI * (0.05 + 0.93 * t)), 0.8) });
        p = add(p, scale(d, l / segs));
      }
      return { rows };
    });
  const params = Array.from({ length: n }, (_, i) => ({
    az: i * 137.5 * DEG + (rng() - 0.5) * 30 * DEG, l: length * between(rng, 0.75, 1), e0: between(rng, 60, 80) * DEG, roll: (rng() - 0.5) * 30 * DEG,
  }));
  const c = crown(0.3 * length, length, length);
  const lod = (segs: number, fold: boolean) => {
    const mb = new MeshBuilder();
    mb.begin('leaf');
    for (const f of fronds(segs, params)) {
      const cols = fold ? [0, 0.5, 1] : [0, 1], ids: number[][] = [];
      f.rows.forEach((r, i) => {
        const t = i / segs;
        ids.push(cols.map((u) => {
          const x = (u - 0.5) * r.w, p = add(add(r.c, scale(r.side, x)), scale(r.up, fold ? Math.abs(x) * 0.35 : 0));
          return mb.vert(p, norm(add(r.up, c.outward(p))), u, t, [t, 1, 1, 0.45 + 0.55 * t]);
        }));
      });
      for (let i = 0; i < segs; i++) for (let j = 0; j + 1 < cols.length; j++) mb.quad(ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j]);
    }
    return mb.build();
  };
  return [lod(12, true), lod(4, false)];
}

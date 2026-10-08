/** Dead wood: fallen logs (a sagging capped tube with branch stubs) and stumps (a flared capped tube with roots). */
import { type Vec3, v3 } from '../../util/vec';
import { between } from '../../util/rng';
import type { LogSpec, StumpSpec } from '../species';
import type { PlantMesh } from '../generator';
import { MeshBuilder, type Shade, tube } from '../mesh';

const ground = (h: number): Shade => (p) => [0, 0.6 + 0.4 * Math.min(1, Math.max(0, p.y / h))];

/** Both LODs of a log `length` m long and `r` m in radius at its root end, lying along x on the ground. */
export function buildLog(_s: LogSpec, rng: () => number, length: number, r: number): [PlantMesh, PlantMesh] {
  const sag = between(rng, -0.1, 0.1), bend = between(rng, -0.3, 0.3), bumps = Array.from({ length: 3 }, () => rng() * 2 * Math.PI);
  const at = (t: number): Vec3 => v3((t - 0.5) * length, r * 0.75 + sag * Math.sin(Math.PI * t) * r, bend * Math.sin(Math.PI * t));
  const radius = (t: number) => r * (1 - 0.3 * t) * (1 + 0.25 * Math.exp(-t * length / 0.4)) * (1 + 0.05 * Math.sin(9 * t + bumps[0]));
  const stubs = Array.from({ length: 2 + Math.floor(rng() * 3) }, () => ({ t: between(rng, 0.25, 0.9), a: between(rng, -0.6, 2.2), l: between(rng, 0.2, 0.5) }));
  const shade = ground(2 * r);
  const lod = (segs: number, sides: number, withStubs: boolean) => {
    const mb = new MeshBuilder(), ts = Array.from({ length: segs + 1 }, (_, i) => i / segs);
    mb.begin('bark');
    tube(mb, ts.map(at), ts.map(radius), sides, 0, shade, () => 0, { start: true, end: true });
    if (withStubs) for (const s of stubs) {
      const c = at(s.t), rr = radius(s.t), d = v3(0, Math.cos(s.a), Math.sin(s.a));
      const tip = v3(c.x, c.y + d.y * (rr + s.l), c.z + d.z * (rr + s.l));
      tube(mb, [c, tip], [rr * 0.3, rr * 0.18], 5, 0, shade, () => 0, { end: true });
    }
    return mb.build();
  };
  return [lod(Math.min(24, Math.ceil(length / 0.5)), 10, true), lod(6, 6, false)];
}

/** Both LODs of a stump `h` m tall and `r` m in radius, flared at the base, with a few roots at LOD0. */
export function buildStump(_s: StumpSpec, rng: () => number, h: number, r: number): [PlantMesh, PlantMesh] {
  const lean = v3(between(rng, -0.04, 0.04), 0, between(rng, -0.04, 0.04));
  const at = (y: number): Vec3 => v3(lean.x * (y + 0.1), y, lean.z * (y + 0.1));
  const radius = (y: number) => r * (1 + 0.6 * Math.exp(-(y + 0.1) / 0.12));
  const nRoots = 3 + Math.floor(rng() * 3);
  const roots = Array.from({ length: nRoots }, (_, i) => ({ az: (i / nRoots) * 2 * Math.PI + rng() * 0.8, l: between(rng, 0.4, 0.8) * r * 2 }));
  const shade = ground(h);
  const lod = (ys: number[], sides: number, withRoots: boolean) => {
    const mb = new MeshBuilder();
    mb.begin('bark');
    tube(mb, ys.map(at), ys.map(radius), sides, 0, shade, () => 0, { end: true });
    if (withRoots) for (const q of roots) {
      const c = Math.cos(q.az), s = Math.sin(q.az), out = (d: number, y: number) => v3(c * d, y, s * d);
      tube(mb, [out(r * 0.6, 0.05), out(r + q.l * 0.5, -0.02), out(r + q.l, -0.12)], [r * 0.35, r * 0.2, r * 0.08], 5, 0, shade, () => 0);
    }
    return mb.build();
  };
  const fine = [-0.1, 0, 0.06, 0.14];
  for (let y = 0.26; y < h - 0.05; y += 0.15) fine.push(y);
  return [lod([...fine, h], 12, true), lod([-0.1, 0.1, h], 6, false)];
}

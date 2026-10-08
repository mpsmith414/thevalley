import type { Pt } from './types';

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Signed distance to a polygon's edge: negative inside, positive outside. */
export function sdPolygon(p: Pt, poly: Pt[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(p, poly[j], poly[i]));
  return pointInPolygon(p, poly) ? -d : d;
}

/** Uniform Catmull-Rom point at `u` (0 … n-1: integers are the control points). Ends are duplicated. */
export function catmullRomAt(points: Pt[], u: number): Pt {
  const n = points.length;
  const i = Math.max(0, Math.min(n - 2, Math.floor(u)));
  const t = u - i, t2 = t * t, t3 = t2 * t;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}

export type PolySample = { p: Pt; s: number /*distance along*/; t: Pt /*unit tangent*/ };

/** Smooth curve through `points`, resampled every `step` metres of arc length. */
export function catmullRom(points: Pt[], step: number): PolySample[] {
  if (points.length < 2) return points.map((p) => ({ p, s: 0, t: { x: 1, z: 0 } }));
  const per = 64, n = (points.length - 1) * per;
  const dense: Pt[] = [], cum: number[] = [0];
  for (let k = 0; k <= n; k++) {
    dense.push(catmullRomAt(points, k / per));
    if (k > 0) cum.push(cum[k - 1] + Math.hypot(dense[k].x - dense[k - 1].x, dense[k].z - dense[k - 1].z));
  }
  const total = cum[n], out: PolySample[] = [];
  let k = 0;
  for (let s = 0; s <= total + 1e-9; s += step) {
    while (k < n - 1 && cum[k + 1] < s) k++;
    const seg = cum[k + 1] - cum[k], f = seg < 1e-12 ? 0 : Math.min(1, (s - cum[k]) / seg);
    const a = dense[k], b = dense[k + 1], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    out.push({ p: { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }, s, t: { x: (b.x - a.x) / l, z: (b.z - a.z) / l } });
  }
  return out;
}

/** Bucket grid over polyline samples for fast nearest-sample queries. */
export type PolylineIndex = { samples: PolySample[]; bucket: number; cells: Map<string, number[]> };

export function buildPolylineIndex(samples: PolySample[], bucket = 16): PolylineIndex {
  const cells = new Map<string, number[]>();
  samples.forEach((q, i) => {
    const key = `${Math.floor(q.p.x / bucket)},${Math.floor(q.p.z / bucket)}`;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  });
  return { samples, bucket, cells };
}

/** Nearest sample to `p`: its index and distance. Searches outward ring by ring of buckets. */
export function nearestOnPolyline(p: Pt, index: PolylineIndex): { i: number; d: number } {
  const { samples, bucket, cells } = index;
  const cx = Math.floor(p.x / bucket), cz = Math.floor(p.z / bucket);
  let bi = -1, bd = Infinity;
  // Bound the search by the farthest occupied bucket so an empty index terminates.
  let maxRing = 0;
  for (const key of cells.keys()) {
    const [kx, kz] = key.split(',').map(Number);
    maxRing = Math.max(maxRing, Math.abs(kx - cx), Math.abs(kz - cz));
  }
  for (let r = 0; r <= maxRing; r++) {
    // Anything in ring r is at least (r - 1) * bucket away; stop once that cannot beat the best.
    if (bi >= 0 && (r - 1) * bucket > bd) break;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const list = cells.get(`${cx + dx},${cz + dz}`);
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(samples[i].p.x - p.x, samples[i].p.z - p.z);
          if (d < bd || (d === bd && i < bi)) { bd = d; bi = i; }
        }
      }
  }
  return { i: bi, d: bd };
}

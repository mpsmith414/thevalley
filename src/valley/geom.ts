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
  if (n < 2) return { ...points[0] };
  const i = Math.max(0, Math.min(n - 2, Math.floor(u)));
  const t = u - i, t2 = t * t, t3 = t2 * t;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) };
}

export type PolySample = { p: Pt; s: number /*distance along*/; t: Pt /*unit tangent*/ };

/** Smooth curve through `points`, resampled every `step` metres of arc length; the exact end point is always the last sample. */
export function catmullRom(points: Pt[], step: number): PolySample[] {
  if (points.length < 2) return points.map((p) => ({ p, s: 0, t: { x: 1, z: 0 } }));
  const per = 64, n = (points.length - 1) * per;
  const dense: Pt[] = [], cum: number[] = [0];
  for (let k = 0; k <= n; k++) {
    dense.push(catmullRomAt(points, k / per));
    if (k > 0) cum.push(cum[k - 1] + Math.hypot(dense[k].x - dense[k - 1].x, dense[k].z - dense[k - 1].z));
  }
  const total = cum[n], out: PolySample[] = [];
  const tangent = (k: number): Pt => {
    const a = dense[k], b = dense[k + 1], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  };
  let k = 0;
  for (let s = 0; s < total - 1e-9; s += step) {
    while (k < n - 1 && cum[k + 1] < s) k++;
    const seg = cum[k + 1] - cum[k], f = seg < 1e-12 ? 0 : Math.min(1, (s - cum[k]) / seg);
    const a = dense[k], b = dense[k + 1];
    out.push({ p: { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f }, s, t: tangent(k) });
  }
  out.push({ p: { ...points[points.length - 1] }, s: total, t: tangent(n - 1) });
  return out;
}

/** Bucket grid over polyline samples for fast nearest-sample queries. `cells` is a flat (w x h) array of sample indices. */
export type PolylineIndex = { samples: PolySample[]; bucket: number; minCx: number; minCz: number; w: number; h: number; cells: (number[] | undefined)[] };

export function buildPolylineIndex(samples: PolySample[], bucket = 16): PolylineIndex {
  if (samples.length === 0) return { samples, bucket, minCx: 0, minCz: 0, w: 0, h: 0, cells: [] };
  let minCx = Infinity, minCz = Infinity, maxCx = -Infinity, maxCz = -Infinity;
  const cx = samples.map((q) => Math.floor(q.p.x / bucket)), cz = samples.map((q) => Math.floor(q.p.z / bucket));
  for (let i = 0; i < samples.length; i++) {
    minCx = Math.min(minCx, cx[i]); maxCx = Math.max(maxCx, cx[i]);
    minCz = Math.min(minCz, cz[i]); maxCz = Math.max(maxCz, cz[i]);
  }
  const w = maxCx - minCx + 1, h = maxCz - minCz + 1;
  const cells: (number[] | undefined)[] = new Array(w * h);
  for (let i = 0; i < samples.length; i++) {
    const c = (cz[i] - minCz) * w + (cx[i] - minCx);
    (cells[c] ??= []).push(i);
  }
  return { samples, bucket, minCx, minCz, w, h, cells };
}

/** Nearest sample to `p`: its index and distance (`{ i: -1, d: Infinity }` for an empty index). Searches outward ring by ring of buckets. */
export function nearestOnPolyline(p: Pt, index: PolylineIndex): { i: number; d: number } {
  const { samples, bucket, minCx, minCz, w, h, cells } = index;
  let bi = -1, bd = Infinity;
  if (w === 0) return { i: bi, d: bd };
  const cx = Math.floor(p.x / bucket) - minCx, cz = Math.floor(p.z / bucket) - minCz; // relative to the grid
  const maxRing = Math.max(Math.abs(cx), Math.abs(cx - (w - 1)), Math.abs(cz), Math.abs(cz - (h - 1)));
  for (let r = 0; r <= maxRing; r++) {
    // Anything in ring r is at least (r - 1) * bucket away; stop once that cannot beat the best.
    if (bi >= 0 && (r - 1) * bucket > bd) break;
    for (let dz = -r; dz <= r; dz++) {
      const z = cz + dz;
      if (z < 0 || z >= h) continue;
      const edge = dz === -r || dz === r;
      for (let dx = -r; dx <= r; dx += edge || r === 0 ? 1 : 2 * r) {
        const x = cx + dx;
        if (x < 0 || x >= w) continue;
        const list = cells[z * w + x];
        if (!list) continue;
        for (const i of list) {
          const d = Math.hypot(samples[i].p.x - p.x, samples[i].p.z - p.z);
          if (d < bd || (d === bd && i < bi)) { bd = d; bi = i; }
        }
      }
    }
  }
  return { i: bi, d: bd };
}

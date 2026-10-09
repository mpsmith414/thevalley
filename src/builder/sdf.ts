import type { FlatFacing, Role } from '../recipe/schema';
import { cross, dot, norm, scale, sub, v3, type Vec3 } from '../util/vec';
import type { BoneDef, Skeleton } from './skeleton';
import { nearReach } from './sparse';

/**
 * Signed distance to a round cone (a capsule with different end radii).
 * Inigo Quilez, "round cone - exact". Negative inside.
 */
export function roundCone(p: Vec3, a: Vec3, b: Vec3, r1: number, r2: number): number {
  return roundConeAt(p.x - a.x, p.y - a.y, p.z - a.z, b.x - a.x, b.y - a.y, b.z - a.z, r1, r2);
}

/** `roundCone` for p − a = (ax, ay, az) and b − a = (bx, by, bz), without allocating (it runs millions of times per body). */
function roundConeAt(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r1: number, r2: number): number {
  const l2 = bx * bx + by * by + bz * bz;
  if (l2 < 1e-12) return Math.hypot(ax, ay, az) - Math.max(r1, r2);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const y = ax * bx + ay * by + az * bz;
  const z = y - l2;
  const xx = ax * l2 - bx * y, xy = ay * l2 - by * y, xz = az * l2 - bz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

/** Polynomial smooth minimum; k = 0 is a plain min. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** How softly each kind of part melts into what it grows from (× the joint radius). */
export function blendFor(role: Role): number {
  switch (role) {
    case 'torso': case 'neck': case 'head': return 0.6;
    case 'tail': return 0.4;
    case 'leg': return 0.25;
    case 'foot': return 0.15;
    case 'ear': case 'fin': case 'wing': return 0.2;
    case 'horn': case 'antenna': return 0.05;
    case 'eye': return 0;
    default: return 0.3;
  }
}

const WORLD: Record<FlatFacing, Vec3> = { up: v3(0, 1, 0), side: v3(1, 0, 0), forward: v3(0, 0, 1) };

/** The axis a squashed part is thin along: the facing direction made perpendicular to the bone. */
export function thinAxis(b: BoneDef): Vec3 {
  const a = norm(sub(b.end, b.start));
  for (const f of [WORLD[b.flatFacing], WORLD.up, WORLD.forward, WORLD.side]) {
    const t = sub(f, scale(a, dot(f, a)));
    if (Math.hypot(t.x, t.y, t.z) > 0.2) return norm(t);
  }
  return norm(cross(a, WORLD.side));
}

export const tipRadius = (b: BoneDef) => (b.pointed ? Math.max(0.002, b.r1 * 0.15) : b.r1);

/** Distance to one bone's own shape (squash and point applied). */
export function boneSdf(p: Vec3, b: BoneDef, thin: Vec3 = thinAxis(b)): number {
  return boneSdfAt(p.x, p.y, p.z, b, thin);
}

/** `boneSdf` at (x, y, z), without allocating. */
export function boneSdfAt(x: number, y: number, z: number, b: BoneDef, thin: Vec3): number {
  const r1 = tipRadius(b);
  const { start: a, end: e } = b;
  const ax = x - a.x, ay = y - a.y, az = z - a.z;
  if (b.squash >= 0.999) return roundConeAt(ax, ay, az, e.x - a.x, e.y - a.y, e.z - a.z, b.r0, r1);
  // stretch space along the thin axis, measure, then scale back (a slight underestimate, fine for meshing)
  const s = (ax * thin.x + ay * thin.y + az * thin.z) * (1 / b.squash - 1);
  return roundConeAt(ax + thin.x * s, ay + thin.y * s, az + thin.z * s, e.x - a.x, e.y - a.y, e.z - a.z, b.r0, r1) * b.squash;
}

/** Per-bone floats bodySdf reads, packed flat: box min/max, start, end − start, r0, tip radius, squash, thin axis, blend, R, sq, 1/|end − start|². */
const STRIDE = 22;

/** The whole body as one distance function: bones blended in tree order. Eyes are separate meshes. */
export function bodySdf(sk: Skeleton, margin = 0.03): (x: number, y: number, z: number) => number {
  const list = sk.bones.filter((b) => b.role !== 'eye');
  const n = list.length, F = new Float64Array(n * STRIDE);
  list.forEach((b, i) => {
    const par = b.parent >= 0 ? sk.bones[b.parent] : null;
    const joint = par ? Math.min(b.r0, Math.max(par.r0, par.r1)) : 0;
    const k = par ? blendFor(b.role) * joint : 0;
    // reach = radius + blend + a margin, so points just off the surface still see this bone exactly
    const r = Math.max(b.r0, b.r1) * 1.5 + k + margin;
    const t = thinAxis(b);
    const dx = b.end.x - b.start.x, dy = b.end.y - b.start.y, dz = b.end.z - b.start.z, l2 = dx * dx + dy * dy + dz * dz;
    F.set([
      Math.min(b.start.x, b.end.x) - r, Math.min(b.start.y, b.end.y) - r, Math.min(b.start.z, b.end.z) - r,
      Math.max(b.start.x, b.end.x) + r, Math.max(b.start.y, b.end.y) + r, Math.max(b.start.z, b.end.z) + r,
      b.start.x, b.start.y, b.start.z, dx, dy, dz,
      b.r0, tipRadius(b), b.squash, t.x, t.y, t.z, k, Math.max(b.r0, b.r1), Math.min(1, b.squash), l2 > 0 ? 1 / l2 : 0,
    ], i * STRIDE);
  });
  const far = 1e3;
  return (x, y, z) => {
    let d = far;
    for (let o = 0; o < n * STRIDE; o += STRIDE) {
      if (d < far) {
        // outside this bone's reach: it can't lower d below the box distance, skip unless d is still "far"
        if (x < F[o] || y < F[o + 1] || z < F[o + 2] || x > F[o + 3] || y > F[o + 4] || z > F[o + 5]) continue;
        // the bone's distance is at least sq·(D − R), D = distance to its segment; when that is ≥ d + k
        // the blend returns d exactly, so skipping it changes nothing
        const lim = (d + F[o + 18]) / F[o + 20] + F[o + 19];
        if (lim <= 0) continue;
        const dx = F[o + 9], dy = F[o + 10], dz = F[o + 11];
        const px = x - F[o + 6], py = y - F[o + 7], pz = z - F[o + 8];
        const u = Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) * F[o + 21]));
        const qx = px - dx * u, qy = py - dy * u, qz = pz - dz * u;
        if (qx * qx + qy * qy + qz * qz >= lim * lim) continue;
      }
      // boneSdf, unrolled
      const ax = x - F[o + 6], ay = y - F[o + 7], az = z - F[o + 8];
      const bx = F[o + 9], by = F[o + 10], bz = F[o + 11];
      const squash = F[o + 14];
      let v: number;
      if (squash >= 0.999) v = roundConeAt(ax, ay, az, bx, by, bz, F[o + 12], F[o + 13]);
      else {
        const tx = F[o + 15], ty = F[o + 16], tz = F[o + 17];
        const s = (ax * tx + ay * ty + az * tz) * (1 / squash - 1);
        v = roundConeAt(ax + tx * s, ay + ty * s, az + tz * s, bx, by, bz, F[o + 12], F[o + 13]) * squash;
      }
      d = d >= far ? v : smin(d, v, F[o + 18]);
    }
    return d;
  };
}

/**
 * The body SDF for a sparse sampler's coarse lattice at fine cell `cell`: its bone-box cull widened by the
 * near reach, so a coarse corner near a thin part never misses that part (see `sampleSparse`).
 */
export const coarseBodySdf = (sk: Skeleton, cell: number, block = 4) => bodySdf(sk, nearReach(cell, block) + 0.03);

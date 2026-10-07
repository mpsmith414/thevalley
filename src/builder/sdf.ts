import type { FlatFacing, Role } from '../recipe/schema';
import { cross, dot, norm, scale, sub, v3, type Vec3 } from '../util/vec';
import type { BoneDef, Skeleton } from './skeleton';

/**
 * Signed distance to a round cone (a capsule with different end radii).
 * Inigo Quilez, "round cone - exact". Negative inside.
 */
export function roundCone(p: Vec3, a: Vec3, b: Vec3, r1: number, r2: number): number {
  const ba = sub(b, a);
  const l2 = dot(ba, ba);
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) - Math.max(r1, r2);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pa = sub(p, a);
  const y = dot(pa, ba);
  const z = y - l2;
  const xv = sub(scale(pa, l2), scale(ba, y));
  const x2 = dot(xv, xv);
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
  const r1 = tipRadius(b);
  if (b.squash >= 0.999) return roundCone(p, b.start, b.end, b.r0, r1);
  // stretch space along the thin axis, measure, then scale back (a slight underestimate, fine for meshing)
  const s = dot(sub(p, b.start), thin) * (1 / b.squash - 1);
  const q = { x: p.x + thin.x * s, y: p.y + thin.y * s, z: p.z + thin.z * s };
  return roundCone(q, b.start, b.end, b.r0, r1) * b.squash;
}

type Prepared = { b: BoneDef; thin: Vec3; k: number; min: Vec3; max: Vec3 };

/** The whole body as one distance function: bones blended in tree order. Eyes are separate meshes. */
export function bodySdf(sk: Skeleton, margin = 0.03): (x: number, y: number, z: number) => number {
  const prepared: Prepared[] = [];
  for (const b of sk.bones) {
    if (b.role === 'eye') continue;
    const par = b.parent >= 0 ? sk.bones[b.parent] : null;
    const joint = par ? Math.min(b.r0, Math.max(par.r0, par.r1)) : 0;
    const k = par ? blendFor(b.role) * joint : 0;
    // reach = radius + blend + a margin, so points just off the surface still see this bone exactly
    const r = Math.max(b.r0, b.r1) * 1.5 + k + margin;
    prepared.push({
      b, k, thin: thinAxis(b),
      min: v3(Math.min(b.start.x, b.end.x) - r, Math.min(b.start.y, b.end.y) - r, Math.min(b.start.z, b.end.z) - r),
      max: v3(Math.max(b.start.x, b.end.x) + r, Math.max(b.start.y, b.end.y) + r, Math.max(b.start.z, b.end.z) + r),
    });
  }
  const far = 1e3;
  return (x, y, z) => {
    let d = far;
    const p = { x, y, z };
    for (const it of prepared) {
      if (x < it.min.x || y < it.min.y || z < it.min.z || x > it.max.x || y > it.max.y || z > it.max.z) {
        // outside this bone's reach: it can't lower d below the box distance, skip unless d is still "far"
        if (d < far) continue;
      }
      d = d >= far ? boneSdf(p, it.b, it.thin) : smin(d, boneSdf(p, it.b, it.thin), it.k);
    }
    return d;
  };
}

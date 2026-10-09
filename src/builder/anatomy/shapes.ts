import { cross, dot, norm, scale, sub, v3, type Vec3 } from '../../util/vec';
import { roundCone, smin } from '../sdf';
import type { BoneDef } from '../skeleton';

/** Colour marks a feature can leave on the skin (Task 9 paints them). */
export type Mark = 'nose' | 'earInner' | 'mouth' | 'hoof';

export type Shape =
  | { type: 'ellipsoid'; c: Vec3; ax: [Vec3, Vec3, Vec3] /* orthonormal */; r: Vec3 /* radius along each axis */ }
  | { type: 'cone'; a: Vec3; b: Vec3; r0: number; r1: number }; // round cone, as the bones

/** An extra shape blended into the body (add), cut out of it (carve), or only colouring it (mark). */
export type Feature = {
  op: 'add' | 'carve' | 'mark';
  shape: Shape;
  k: number; // blend radius (smooth union / smooth subtraction)
  mark?: Mark; markBand?: number; // vertices within markBand of the shape's surface get the mark
  facing?: Vec3; // earInner only: the ear's front axis (marks only front-facing vertices)
  min: Vec3; max: Vec3; // reach box: shape bounds + max(k, markBand); bodySdf widens it by its margin
  name?: string; bone?: number; // which rule made it and from which bone (tests, debugging)
};

/** Signed distance to a shape: ellipsoid by Inigo Quilez's bound k0·(k0 − 1)/k1, cone exactly. */
export function shapeSdf(p: Vec3, s: Shape): number {
  if (s.type === 'cone') return roundCone(p, s.a, s.b, s.r0, s.r1);
  const d = sub(p, s.c);
  const q0 = dot(d, s.ax[0]), q1 = dot(d, s.ax[1]), q2 = dot(d, s.ax[2]);
  return ellipsoidAt(q0, q1, q2, s.r.x, s.r.y, s.r.z);
}

/** The ellipsoid bound for local coordinates (q0, q1, q2) and radii (a, b, c). */
export function ellipsoidAt(q0: number, q1: number, q2: number, a: number, b: number, c: number): number {
  const k0 = Math.hypot(q0 / a, q1 / b, q2 / c);
  const k1 = Math.hypot(q0 / (a * a), q1 / (b * b), q2 / (c * c));
  return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(a, b, c);
}

/** The shape's axis-aligned bounds. */
function bounds(s: Shape): { min: Vec3; max: Vec3 } {
  if (s.type === 'cone') {
    const r = Math.max(s.r0, s.r1);
    return {
      min: v3(Math.min(s.a.x, s.b.x) - r, Math.min(s.a.y, s.b.y) - r, Math.min(s.a.z, s.b.z) - r),
      max: v3(Math.max(s.a.x, s.b.x) + r, Math.max(s.a.y, s.b.y) + r, Math.max(s.a.z, s.b.z) + r),
    };
  }
  const [u, v, w] = s.ax, { x: a, y: b, z: c } = s.r;
  // half-extent along a world axis: |(a·u_i, b·v_i, c·w_i)|
  const e = v3(Math.hypot(a * u.x, b * v.x, c * w.x), Math.hypot(a * u.y, b * v.y, c * w.y), Math.hypot(a * u.z, b * v.z, c * w.z));
  return { min: sub(s.c, e), max: v3(s.c.x + e.x, s.c.y + e.y, s.c.z + e.z) };
}

/** A feature with its reach box (shape bounds grown by its blend radius or mark band). */
export function feature(op: Feature['op'], shape: Shape, k: number, extra: Partial<Pick<Feature, 'mark' | 'markBand' | 'facing' | 'name' | 'bone'>> = {}): Feature {
  const { min, max } = bounds(shape);
  const g = Math.max(k, extra.markBand ?? 0);
  return { op, shape, k, ...extra, min: v3(min.x - g, min.y - g, min.z - g), max: v3(max.x + g, max.y + g, max.z + g) };
}

/** The largest radius of a shape (for skipping features too small to mesh). */
export const shapeSize = (s: Shape) => (s.type === 'cone' ? Math.max(s.r0, s.r1) : Math.max(s.r.x, s.r.y, s.r.z));

/** A bone's frame: `a` along it, `up` = world up made perpendicular (forward, then side, if it is vertical), side = up × a. */
export type Frame = { a: Vec3; up: Vec3; side: Vec3 };

const WORLD_UP = v3(0, 1, 0), FORWARD = v3(0, 0, 1), SIDE = v3(1, 0, 0);

export function boneFrame(b: BoneDef): Frame {
  const a = norm(sub(b.end, b.start));
  let up = FORWARD;
  for (const f of [WORLD_UP, FORWARD, SIDE]) {
    const t = sub(f, scale(a, dot(f, a)));
    if (Math.hypot(t.x, t.y, t.z) > 0.2) { up = norm(t); break; }
  }
  return { a, up, side: norm(cross(up, a)) };
}

/** Polynomial smooth maximum: −smin(−a, −b, k). */
export const smax = (a: number, b: number, k: number): number => -smin(-a, -b, k);

import { add, cross, dist, dot, len, norm, scale, sub, type Vec3 } from '../util/vec';

/** Rotate point p around the line through a with unit direction axis by angle (Rodrigues). */
function rotateAbout(p: Vec3, a: Vec3, axis: Vec3, angle: number): Vec3 {
  const v = sub(p, a);
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
  return add(a, r);
}

/**
 * FABRIK: move a chain's joints so its tip reaches the target, keeping bone lengths and the root fixed.
 * `pole` (optional) is a point the middle joints bend towards (knees, elbows).
 */
export function fabrik(joints: Vec3[], lengths: number[], target: Vec3, pole: Vec3 | null, iterations = 12): Vec3[] {
  const p = joints.map((j) => ({ ...j }));
  const n = p.length;
  const root = { ...p[0] };
  const total = lengths.reduce((s, l) => s + l, 0);
  if (dist(root, target) >= total) {
    // out of reach: straighten towards the target
    const d = norm(sub(target, root));
    for (let i = 1; i < n; i++) p[i] = add(p[i - 1], scale(d, lengths[i - 1]));
    return p;
  }
  if (pole) {
    // a perfectly straight chain has no bend direction; nudge the middle joints towards the pole first
    for (let i = 1; i < n - 1; i++) p[i] = add(p[i], scale(norm(sub(pole, p[i])), total * 0.01));
  }
  for (let it = 0; it < iterations; it++) {
    p[n - 1] = { ...target };
    for (let i = n - 2; i >= 0; i--) p[i] = add(p[i + 1], scale(norm(sub(p[i], p[i + 1])), lengths[i]));
    p[0] = { ...root };
    for (let i = 1; i < n; i++) p[i] = add(p[i - 1], scale(norm(sub(p[i], p[i - 1])), lengths[i - 1]));
    if (pole) {
      // swing each middle joint around the line between its neighbours, as close to the pole as it can get
      for (let i = 1; i < n - 1; i++) {
        const a = p[i - 1], b = p[i + 1];
        const axisRaw = sub(b, a);
        if (len(axisRaw) < 1e-9) continue;
        const axis = norm(axisRaw);
        const proj = (q: Vec3) => {
          const v = sub(q, a);
          return sub(v, scale(axis, dot(v, axis)));
        };
        const j = proj(p[i]), t = proj(pole);
        if (len(j) < 1e-9 || len(t) < 1e-9) continue;
        const angle = Math.atan2(dot(cross(j, t), axis), dot(j, t));
        p[i] = rotateAbout(p[i], a, axis, angle);
      }
    }
    if (dist(p[n - 1], target) < 1e-5) break;
  }
  return p;
}

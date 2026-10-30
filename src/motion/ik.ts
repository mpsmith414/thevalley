import type { Vec3 } from '../util/vec';

/**
 * FABRIK: move a chain's joints so its tip reaches the target, keeping bone lengths and the root fixed.
 * `pole` (optional) is a point the middle joints bend towards (knees, elbows).
 */
export function fabrik(joints: Vec3[], lengths: number[], target: Vec3, pole: Vec3 | null, iterations = 12): Vec3[] {
  return fabrikInto(joints.map((j) => ({ ...j })), lengths, target, pole, iterations);
}

/**
 * FABRIK in place: moves the joints `p` themselves (no allocation, for chains solved every frame) and returns them.
 * The arithmetic is the vector helpers' (`add`, `scale`, `norm`, …) written out in scalars, in their order, so it gives
 * bit for bit what they would.
 */
export function fabrikInto(p: Vec3[], lengths: number[], target: Vec3, pole: Vec3 | null, iterations = 12): Vec3[] {
  const n = p.length;
  const rx = p[0].x, ry = p[0].y, rz = p[0].z;
  let total = 0;
  for (let i = 0; i < lengths.length; i++) total += lengths[i];
  const tx = target.x, ty = target.y, tz = target.z;
  let dx = rx - tx, dy = ry - ty, dz = rz - tz;
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= total) {
    // out of reach: straighten towards the target
    dx = tx - rx, dy = ty - ry, dz = tz - rz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-9) (dx = 0), (dy = 0), (dz = 1);
    else {
      const k = 1 / l;
      (dx *= k), (dy *= k), (dz *= k);
    }
    for (let i = 1; i < n; i++) {
      const a = p[i - 1], b = p[i], s = lengths[i - 1];
      b.x = a.x + dx * s;
      b.y = a.y + dy * s;
      b.z = a.z + dz * s;
    }
    return p;
  }
  if (pole) {
    // a perfectly straight chain has no bend direction; nudge the middle joints towards the pole first
    for (let i = 1; i < n - 1; i++) toward(p[i], pole.x - p[i].x, pole.y - p[i].y, pole.z - p[i].z, p[i], total * 0.01);
  }
  for (let it = 0; it < iterations; it++) {
    const tip = p[n - 1];
    (tip.x = tx), (tip.y = ty), (tip.z = tz);
    for (let i = n - 2; i >= 0; i--) {
      const a = p[i + 1], b = p[i];
      toward(a, b.x - a.x, b.y - a.y, b.z - a.z, b, lengths[i]);
    }
    (p[0].x = rx), (p[0].y = ry), (p[0].z = rz);
    for (let i = 1; i < n; i++) {
      const a = p[i - 1], b = p[i];
      toward(a, b.x - a.x, b.y - a.y, b.z - a.z, b, lengths[i - 1]);
    }
    if (pole) {
      // swing each middle joint around the line between its neighbours, as close to the pole as it can get
      for (let i = 1; i < n - 1; i++) {
        const a = p[i - 1], b = p[i + 1], q = p[i];
        let ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
        const al = Math.sqrt(ax * ax + ay * ay + az * az);
        if (al < 1e-9) continue;
        const k = 1 / al;
        (ax *= k), (ay *= k), (az *= k);
        // the joint and the pole, each less its run along the axis, from a
        let vx = q.x - a.x, vy = q.y - a.y, vz = q.z - a.z, d = vx * ax + vy * ay + vz * az;
        const jx = vx - ax * d, jy = vy - ay * d, jz = vz - az * d;
        vx = pole.x - a.x, vy = pole.y - a.y, vz = pole.z - a.z, d = vx * ax + vy * ay + vz * az;
        const px = vx - ax * d, py = vy - ay * d, pz = vz - az * d;
        if (Math.sqrt(jx * jx + jy * jy + jz * jz) < 1e-9 || Math.sqrt(px * px + py * py + pz * pz) < 1e-9) continue;
        const cx = jy * pz - jz * py, cy = jz * px - jx * pz, cz = jx * py - jy * px;
        const angle = Math.atan2(cx * ax + cy * ay + cz * az, jx * px + jy * py + jz * pz);
        // rotate the joint about the axis through a by that angle (Rodrigues)
        vx = q.x - a.x, vy = q.y - a.y, vz = q.z - a.z;
        const c = Math.cos(angle), s = Math.sin(angle), w = (ax * vx + ay * vy + az * vz) * (1 - c);
        const kx = ay * vz - az * vy, ky = az * vx - ax * vz, kz = ax * vy - ay * vx;
        q.x = a.x + (vx * c + kx * s + ax * w);
        q.y = a.y + (vy * c + ky * s + ay * w);
        q.z = a.z + (vz * c + kz * s + az * w);
      }
    }
    dx = p[n - 1].x - tx, dy = p[n - 1].y - ty, dz = p[n - 1].z - tz;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 1e-5) break;
  }
  return p;
}

/** out = from + norm(v)·s, v = (vx, vy, vz) (a zero v points along +z). `out` may be `from`. */
function toward(from: Vec3, vx: number, vy: number, vz: number, out: Vec3, s: number) {
  const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (l < 1e-9) (vx = 0), (vy = 0), (vz = 1);
  else {
    const k = 1 / l;
    (vx *= k), (vy *= k), (vz *= k);
  }
  out.x = from.x + vx * s;
  out.y = from.y + vy * s;
  out.z = from.z + vz * s;
}

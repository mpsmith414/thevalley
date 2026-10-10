import { norm, scale, sub, type Vec3 } from '../util/vec';
import type { Skeleton } from './skeleton';

/** How strongly hair on a steep side lies down (towards -y) on top of its bones' flow. */
const SAG = 0.25;
/** A projected direction shorter than this fraction of the unprojected one is degenerate (it points through the surface). */
const DEGENERATE = 0.2;
const EPS = 1e-6;

/** Each bone's hair flow (creature space, unit; zero for eyes), from its role: tail-wards on the body, outwards on limbs. */
export function boneFlows(sk: Skeleton): Vec3[] {
  const head = sk.bones.find((b) => b.role === 'head')?.start ?? sk.bones[0].end;
  return sk.bones.map((b) => {
    const d = norm(sub(b.end, b.start), { x: 0, y: 0, z: 1 });
    switch (b.role) {
      case 'eye': return { x: 0, y: 0, z: 0 };
      case 'torso': {
        const mid = { x: (b.start.x + b.end.x) / 2, y: (b.start.y + b.end.y) / 2, z: (b.start.z + b.end.z) / 2 };
        const h = sub(head, mid), away = Math.hypot(h.x, h.y, h.z) < EPS || d.x * h.x + d.y * h.y + d.z * h.z > 0;
        return away ? scale(d, -1) : d; // flows away from the head
      }
      case 'neck': case 'head': case 'mouth': return scale(d, -1);
      default: return d; // leg, foot, tail, ear, antenna, wing, fin and anything else
    }
  });
}

/**
 * The hair direction at every vertex: its bones' flows blended by skin weight, a little downward on steep sides,
 * projected onto the surface and smoothed over the mesh (`passes` Laplacian passes). Unit tangents, or zero where every
 * weighted bone has no flow. 3 per vertex.
 */
export function groomField(positions: Float32Array, normals: Float32Array, indices: Uint32Array,
  skinIndex: Uint16Array, skinWeight: Float32Array, sk: Skeleton, passes = 4): Float32Array {
  const n = positions.length / 3, flow = boneFlows(sk);
  let g = new Float32Array(n * 3);
  const eye = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let fx = 0, fy = 0, fz = 0, best = -1, top = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[v * 4 + k], b = skinIndex[v * 4 + k], f = flow[b];
      fx += w * f.x; fy += w * f.y; fz += w * f.z;
      if (w > best) { best = w; top = b; }
    }
    if (sk.bones[top].role === 'eye') { eye[v] = 1; continue; }
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    let fl = Math.hypot(fx, fy, fz);
    if (fl > EPS) { fy -= SAG * (1 - Math.abs(ny)); fl = Math.hypot(fx, fy, fz); }
    if (fl < EPS) continue;
    const d = fx * nx + fy * ny + fz * nz, gx = fx - d * nx, gy = fy - d * ny, gz = fz - d * nz;
    if (Math.hypot(gx, gy, gz) < DEGENERATE * fl) continue; // degenerate: left zero for its neighbours to fill
    g[v * 3] = gx; g[v * 3 + 1] = gy; g[v * 3 + 2] = gz;
  }
  // unique neighbours, in CSR form
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = indices[t + k], b = indices[t + (k + 1) % 3];
    nb[a].add(b); nb[b].add(a);
  }
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      if (eye[v]) continue;
      let sx = g[v * 3], sy = g[v * 3 + 1], sz = g[v * 3 + 2];
      for (const u of nb[v]) { sx += g[u * 3]; sy += g[u * 3 + 1]; sz += g[u * 3 + 2]; }
      const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2], d = sx * nx + sy * ny + sz * nz;
      sx -= d * nx; sy -= d * ny; sz -= d * nz;
      const l = Math.hypot(sx, sy, sz);
      if (l < EPS) continue;
      out[v * 3] = sx / l; out[v * 3 + 1] = sy / l; out[v * 3 + 2] = sz / l;
    }
    g = out;
  }
  // anything still empty (not an eye) lies down, else back
  for (let v = 0; v < n; v++) {
    if (eye[v] || Math.hypot(g[v * 3], g[v * 3 + 1], g[v * 3 + 2]) > EPS) continue;
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    for (const [ax, ay, az] of [[0, -1, 0], [0, 0, -1]]) {
      const d = ax * nx + ay * ny + az * nz, px = ax - d * nx, py = ay - d * ny, pz = az - d * nz, l = Math.hypot(px, py, pz);
      if (l > EPS) { g[v * 3] = px / l; g[v * 3 + 1] = py / l; g[v * 3 + 2] = pz / l; break; }
    }
  }
  return g;
}

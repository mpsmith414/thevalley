import type { Vec3 } from '../util/vec';

export type MeshData = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };
export type Sdf = (x: number, y: number, z: number) => number;

// the 12 cube edges as pairs of corner indices; corner c sits at offset (c&1, (c>>1)&1, (c>>2)&1)
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

/**
 * Surface nets: one vertex per cell the surface passes through (at the average of its edge
 * crossings), one quad per grid edge the surface crosses. Inside is sdf < 0.
 */
export function surfaceNets(sdf: Sdf, min: Vec3, max: Vec3, cell: number): MeshData {
  const pad = 2;
  const ox = min.x - pad * cell, oy = min.y - pad * cell, oz = min.z - pad * cell;
  const nx = Math.ceil((max.x - min.x) / cell) + 2 * pad + 1;
  const ny = Math.ceil((max.y - min.y) / cell) + 2 * pad + 1;
  const nz = Math.ceil((max.z - min.z) / cell) + 2 * pad + 1;
  const sy = nx, sz = nx * ny;
  const val = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) val[i + j * sy + k * sz] = sdf(ox + i * cell, oy + j * cell, oz + k * cell);

  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const base = i + j * sy + k * sz;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = val[base + (c & 1) + ((c >> 1) & 1) * sy + ((c >> 2) & 1) * sz];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let px = 0, py = 0, pz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          px += (a & 1) + t * ((b & 1) - (a & 1));
          py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
          pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
          n++;
        }
        cellVert[base] = pos.length / 3;
        pos.push(ox + (i + px / n) * cell, oy + (j + py / n) * cell, oz + (k + pz / n) * cell);
      }

  // quads: for each grid edge with a sign change, join the 4 cells around it
  const idx: number[] = [];
  const strides = [1, sy, sz];
  const dims = [nx, ny, nz];
  for (let d = 0; d < 3; d++) {
    const su = strides[(d + 1) % 3], sw = strides[(d + 2) % 3];
    for (let k = 1; k < nz - 1; k++)
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++) {
          if ((d === 0 ? i : d === 1 ? j : k) >= dims[d] - 1) continue;
          const a = i + j * sy + k * sz;
          const inA = val[a] < 0, inB = val[a + strides[d]] < 0;
          if (inA === inB) continue;
          const v0 = cellVert[a], v1 = cellVert[a - su], v2 = cellVert[a - su - sw], v3 = cellVert[a - sw];
          if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) continue;
          // inside → outside along +d means the surface faces +d
          if (inA) idx.push(v0, v1, v2, v0, v2, v3);
          else idx.push(v0, v2, v1, v0, v3, v2);
        }
  }

  const positions = new Float32Array(pos);
  const normals = new Float32Array(pos.length);
  const h = cell * 0.5;
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v], y = positions[v + 1], z = positions[v + 2];
    const gx = sdf(x + h, y, z) - sdf(x - h, y, z);
    const gy = sdf(x, y + h, z) - sdf(x, y - h, z);
    const gz = sdf(x, y, z + h) - sdf(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals[v] = gx / l;
    normals[v + 1] = gy / l;
    normals[v + 2] = gz / l;
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}

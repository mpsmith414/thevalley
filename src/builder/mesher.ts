import type { Vec3 } from '../util/vec';
import type { SparseField } from './sparse';

export type MeshData = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };
export type Sdf = (x: number, y: number, z: number) => number;

// the 12 cube edges as pairs of corner indices; corner c sits at offset (c&1, (c>>1)&1, (c>>2)&1)
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

const cr = new Float64Array(3);
/** Average of a cell's edge crossings (in cell units) into `cr`, from its 8 corner values; false if none. */
function crossing(corner: Float32Array): boolean {
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
  if (n === 0) return false;
  cr[0] = px / n; cr[1] = py / n; cr[2] = pz / n;
  return true;
}

/** Two triangles for the 4 cells around a sign-changing grid edge; inside → outside along +d faces +d. */
function pushQuad(idx: number[], inA: boolean, v0: number, v1: number, v2: number, v3: number): void {
  if (inA) idx.push(v0, v1, v2, v0, v2, v3);
  else idx.push(v0, v2, v1, v0, v3, v2);
}

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
        for (let c = 0; c < 8; c++) corner[c] = val[base + (c & 1) + ((c >> 1) & 1) * sy + ((c >> 2) & 1) * sz];
        if (!crossing(corner)) continue;
        cellVert[base] = pos.length / 3;
        pos.push(ox + (i + cr[0]) * cell, oy + (j + cr[1]) * cell, oz + (k + cr[2]) * cell);
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
          pushQuad(idx, inA, v0, v1, v2, v3);
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

/**
 * Surface nets over a sparse field: only fine cells inside active blocks (ascending block, then
 * k, j, i); same vertices and winding as `surfaceNets`. No normals: positions and indices only.
 */
export function surfaceNetsSparse(f: SparseField): { positions: Float32Array; indices: Uint32Array } {
  const B = f.block, B3 = B * B * B, L = B + 1;
  const nbx = (f.dims[0] - 1) / B, nby = (f.dims[1] - 1) / B, nbz = (f.dims[2] - 1) / B;
  const { x: ox, y: oy, z: oz } = f.origin, cell = f.cell, blocks = f.blocks;
  const slot = new Int32Array(nbx * nby * nbz).fill(-1);
  for (let s = 0; s < blocks.length; s++) slot[blocks[s]] = s;

  // pass 1: a vertex per surface cell; `edges` bits 0-2 = the cell's +x/+y/+z edge changes sign, bit 3 = corner 0 inside
  const cellVert = new Int32Array(blocks.length * B3).fill(-1);
  const edges = new Uint8Array(blocks.length * B3);
  const pos: number[] = [];
  const local = new Float32Array(L * L * L);
  const corner = new Float32Array(8);
  for (let s = 0; s < blocks.length; s++) {
    const id = blocks[s];
    const bx = (id % nbx) * B, by = (((id / nbx) | 0) % nby) * B, bz = ((id / (nbx * nby)) | 0) * B;
    for (let n = 0, lz = 0; lz < L; lz++)
      for (let ly = 0; ly < L; ly++)
        for (let lx = 0; lx < L; lx++) local[n++] = f.value(bx + lx, by + ly, bz + lz);
    for (let lz = 0; lz < B; lz++)
      for (let ly = 0; ly < B; ly++)
        for (let lx = 0; lx < B; lx++) {
          const base = lx + ly * L + lz * L * L;
          for (let c = 0; c < 8; c++) corner[c] = local[base + (c & 1) + ((c >> 1) & 1) * L + ((c >> 2) & 1) * L * L];
          if (!crossing(corner)) continue;
          const n = s * B3 + lx + ly * B + lz * B * B;
          const in0 = corner[0] < 0;
          edges[n] = (corner[1] < 0 !== in0 ? 1 : 0) | (corner[2] < 0 !== in0 ? 2 : 0) | (corner[4] < 0 !== in0 ? 4 : 0) | (in0 ? 8 : 0);
          cellVert[n] = pos.length / 3;
          pos.push(ox + (bx + lx + cr[0]) * cell, oy + (by + ly + cr[1]) * cell, oz + (bz + lz + cr[2]) * cell);
        }
  }

  /** Vertex id of the fine cell (x, y, z), or -1 when it has none or lies in an inactive block. */
  const vertAt = (x: number, y: number, z: number): number => {
    if (x < 0 || y < 0 || z < 0) return -1;
    const bx = (x / B) | 0, by = (y / B) | 0, bz = (z / B) | 0;
    const s = slot[bx + by * nbx + bz * nbx * nby];
    return s < 0 ? -1 : cellVert[s * B3 + (x - bx * B) + (y - by * B) * B + (z - bz * B) * B * B];
  };

  // pass 2: a quad per sign-changing edge, joining the 4 cells around it
  const idx: number[] = [];
  const g = [0, 0, 0], u = [0, 0, 0];
  for (let s = 0; s < blocks.length; s++) {
    const id = blocks[s];
    const bx = (id % nbx) * B, by = (((id / nbx) | 0) % nby) * B, bz = ((id / (nbx * nby)) | 0) * B;
    for (let lz = 0; lz < B; lz++)
      for (let ly = 0; ly < B; ly++)
        for (let lx = 0; lx < B; lx++) {
          const n = s * B3 + lx + ly * B + lz * B * B;
          const e = edges[n];
          if ((e & 7) === 0) continue;
          g[0] = bx + lx; g[1] = by + ly; g[2] = bz + lz;
          for (let d = 0; d < 3; d++) {
            if (!(e & (1 << d))) continue;
            const a = (d + 1) % 3, b = (d + 2) % 3;
            u[0] = g[0]; u[1] = g[1]; u[2] = g[2];
            u[a]--;
            const v1 = vertAt(u[0], u[1], u[2]);
            u[b]--;
            const v2 = vertAt(u[0], u[1], u[2]);
            u[a]++;
            const v3 = vertAt(u[0], u[1], u[2]);
            if (v1 < 0 || v2 < 0 || v3 < 0) continue;
            pushQuad(idx, (e & 8) !== 0, cellVert[n], v1, v2, v3);
          }
        }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshStandardNodeMaterial } from 'three/webgpu';
import { cameraPosition, color, mix, positionWorld, smoothstep } from 'three/tsl';
import { createNoise2D, ridged } from '../valley/generate/noise';
import { sampleHeight, type HeightGrid } from '../valley/generate/shape';
import type { ValleyData } from '../valley/types';

const AROUND = 256, OUT = 48, FAR = 6000, SKIRT = 40;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The mountains around the Valley: a polar grid (256 around × 48 out) from the valley square's edge out to 6 km.
 * The inner ring takes the valley's border height (the lowest along its two neighbouring segments, so it never pokes
 * above the terrain's edge) with a short skirt below it; heights rise outward to 300–900 m of ridged noise.
 * `seed` is the layout's (so the mountains stay put when only the generator or the grid changes). Casts no shadows.
 */
export function createBackdrop(d: ValleyData, seed: number): Mesh {
  const half = d.size / 2, g: HeightGrid = { grid: d.grid, size: d.size, cell: d.size / (d.grid - 1), h: d.height };
  const noise = createNoise2D(seed ^ 0x6d6f756e);
  const edge = (a: number) => {
    const c = Math.cos(a), s = Math.sin(a), r = half / Math.max(Math.abs(c), Math.abs(s));
    return { x: c * r, z: s * r, r };
  };
  // the border height under each inner vertex: the lowest along the edge to both neighbours, sampled every metre or so
  const border = new Float32Array(AROUND);
  const step = (2 * Math.PI) / AROUND;
  for (let i = 0; i < AROUND; i++) {
    let lo = Infinity;
    for (let t = -1; t <= 1; t += 1 / 32) {
      const p = edge((i + t) * step);
      lo = Math.min(lo, sampleHeight(g, p.x, p.z));
    }
    border[i] = lo - 0.3;
  }

  const rings = OUT + 2, pos = new Float32Array(AROUND * rings * 3); // ring 0 is the skirt
  for (let i = 0; i < AROUND; i++) {
    const a = i * step, e = edge(a), c = Math.cos(a), s = Math.sin(a);
    for (let j = 0; j < rings; j++) {
      const o = (j * AROUND + i) * 3;
      if (j === 0) { pos.set([e.x, border[i] - SKIRT, e.z], o); continue; }
      const t = (j - 1) / OUT, r = e.r + (FAR - e.r) * t ** 1.6, x = c * r, z = s * r;
      const peak = 300 + 600 * ridged(noise, x / 1700, z / 1700, 5);
      const foot = border[i] + 25 * ridged(noise, x / 300 + 40, z / 300, 3) * smooth(0, 0.04, t);
      pos.set([x, foot + (peak - foot) * smooth(0.02, 0.4, t), z], o);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < AROUND; i++) {
    const i1 = (i + 1) % AROUND, a = j * AROUND + i, b = j * AROUND + i1, c = a + AROUND, dd = b + AROUND;
    idx.push(a, b, c, b, dd, c);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: DoubleSide });
  const dist = positionWorld.sub(cameraPosition).length();
  const rock = mix(color('#2e3f3c'), color('#46554f'), smoothstep(250, 800, positionWorld.y));
  mat.colorNode = mix(rock, color('#6f7c80'), smoothstep(900, 5000, dist).mul(0.7)); // greyer with distance; fog does the rest
  const mesh = new Mesh(geo, mat);
  mesh.name = 'backdrop';
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

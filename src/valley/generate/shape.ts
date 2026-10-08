import type { Layout } from '../types';
import { createNoise2D, fbm, ridged } from './noise';

/** Square grid of terrain heights: `grid` samples per side, `cell` metres apart, index `iz * grid + ix`. */
export type HeightGrid = { grid: number; size: number; cell: number; h: Float32Array };

/** Array index of sample (ix, iz). */
export const gridIndex = (g: HeightGrid, ix: number, iz: number) => iz * g.grid + ix;

/** Bilinear height at world (x, z); positions outside the grid clamp to the border. */
export function sampleHeight(g: HeightGrid, x: number, z: number): number {
  const half = g.size / 2, max = g.grid - 1;
  const fx = Math.min(max, Math.max(0, (x + half) / g.cell)), fz = Math.min(max, Math.max(0, (z + half) / g.cell));
  const ix = Math.min(max - 1, Math.floor(fx)), iz = Math.min(max - 1, Math.floor(fz));
  const tx = fx - ix, tz = fz - iz, i = iz * g.grid + ix, h = g.h;
  const a = h[i] + (h[i + 1] - h[i]) * tx, b = h[i + g.grid] + (h[i + g.grid + 1] - h[i + g.grid]) * tx;
  return a + (b - a) * tz;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bump = (t: number) => (t < 1 ? (1 - t * t) * (1 - t * t) : 0);

/**
 * The terrain before erosion: a bowl with a raised rim, the layout's ridges on top (max, not sum),
 * and noise that grows with relief, so the floor stays gentle and the hills get rough and rocky.
 */
export function baseShape(layout: Layout, grid: number): HeightGrid {
  const { size, floor, rim, ridges } = layout;
  const cell = size / (grid - 1), half = size / 2;
  const h = new Float32Array(grid * grid);
  const n = createNoise2D(layout.seed), n2 = createNoise2D(layout.seed ^ 0x5bd1e995);
  // Flatten every ridge into segments (a single point becomes a zero-length one) for exact distances.
  const segs: number[] = [], segRidge: number[] = [];
  ridges.forEach((r, k) => {
    const pts = r.points;
    for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
      const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
      segs.push(a.x, a.z, b.x - a.x, b.z - a.z);
      segRidge.push(k);
    }
  });
  const nr = ridges.length, ns = segRidge.length;
  const dmin = new Float64Array(nr);
  for (let iz = 0; iz < grid; iz++) {
    const z = -half + iz * cell;
    for (let ix = 0; ix < grid; ix++) {
      const x = -half + ix * cell;
      let y = floor + rim * smoothstep(0.55, 1, Math.max(Math.abs(x), Math.abs(z)) / half);
      dmin.fill(Infinity);
      for (let s = 0; s < ns; s++) {
        const ax = segs[s * 4], az = segs[s * 4 + 1], dx = segs[s * 4 + 2], dz = segs[s * 4 + 3], l2 = dx * dx + dz * dz;
        const t = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.sqrt((x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2), k = segRidge[s];
        if (d < dmin[k]) dmin[k] = d;
      }
      let up = 0, rocky = 0;
      for (let k = 0; k < nr; k++) {
        const b = bump(dmin[k] / ridges[k].width);
        if (b === 0) continue;
        const r = ridges[k];
        up = Math.max(up, r.height * b);
        rocky = Math.max(rocky, r.rocky * b);
      }
      y += up;
      const relief = smoothstep(2, 30, y - floor);
      y += (1.5 + 10 * relief) * fbm(n, x / 220, z / 220, 5);
      if (rocky > 0 && relief > 0) y += rocky * 18 * relief * ridged(n2, x / 90, z / 90, 4);
      h[iz * grid + ix] = y;
    }
  }
  return { grid, size, cell, h };
}

import type { Layout } from '../types';
import { sdPolygon } from '../geom';
import { createNoise2D, fbm } from './noise';
import type { WaterMaps } from './carve';
import type { HeightGrid } from './shape';

/**
 * Area-edge wobble in metres: broad bays at 140 m plus a ragged edge at 35 m. fbm's spread is small (std about 0.21, at most
 * about 0.67), so these give about ±23 m and ±6 m typical (90 m at most together).
 */
const WOBBLE = 110, RAGGED = 30;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Distance in metres to the nearest water cell for every map cell: a two-pass (3-4 style, 1 and sqrt 2) chamfer transform. */
function waterDistance(kind: Uint8Array, m: number, mapCell: number): Float32Array {
  const far = 1e6, d = new Float32Array(m * m), D = Math.SQRT2;
  for (let c = 0; c < d.length; c++) d[c] = kind[c] !== 0 ? 0 : far;
  for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
    const c = z * m + x;
    let v = d[c];
    if (x > 0) v = Math.min(v, d[c - 1] + 1);
    if (z > 0) {
      v = Math.min(v, d[c - m] + 1);
      if (x > 0) v = Math.min(v, d[c - m - 1] + D);
      if (x < m - 1) v = Math.min(v, d[c - m + 1] + D);
    }
    d[c] = v;
  }
  for (let z = m - 1; z >= 0; z--) for (let x = m - 1; x >= 0; x--) {
    const c = z * m + x;
    let v = d[c];
    if (x < m - 1) v = Math.min(v, d[c + 1] + 1);
    if (z < m - 1) {
      v = Math.min(v, d[c + m] + 1);
      if (x < m - 1) v = Math.min(v, d[c + m + 1] + D);
      if (x > 0) v = Math.min(v, d[c + m - 1] + D);
    }
    d[c] = v;
  }
  for (let c = 0; c < d.length; c++) d[c] *= mapCell;
  return d;
}

/**
 * Biome weights on the map grid, 6 bytes per cell: forest, meadow, rock, shore, beach (the five sum to 255), then moisture.
 * Weights come from slope, height, the layout's areas (with noisy edges) and the distance to water.
 * Map node (ix, iz) sits on height sample (2ix, 2iz).
 */
export function computeBiomes(g: HeightGrid, water: WaterMaps, layout: Layout): Uint8Array {
  const m = water.mapGrid, grid = g.grid, h = g.h, half = g.size / 2, mapCell = 2 * g.cell;
  const wdist = waterDistance(water.kind, m, mapCell), n = createNoise2D(layout.seed ^ 0x6b1d);
  const out = new Uint8Array(m * m * 6);
  const areas = layout.areas.map((a) => {
    const wob = Math.min(1, a.soft / 30), reach = a.soft / 2 + (WOBBLE + RAGGED) * wob; // area weight and wobble can't reach farther
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of a.points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    return { a, wob, x0: x0 - reach, x1: x1 + reach, z0: z0 - reach, z1: z1 + reach };
  });
  const w = [0, 0, 0, 0, 0];
  for (let iz = 0; iz < m; iz++) {
    const z = -half + iz * mapCell, jz = 2 * iz, jz0 = Math.max(0, jz - 1), jz1 = Math.min(grid - 1, jz + 1);
    for (let ix = 0; ix < m; ix++) {
      const x = -half + ix * mapCell, c = iz * m + ix, jx = 2 * ix, jx0 = Math.max(0, jx - 1), jx1 = Math.min(grid - 1, jx + 1);
      const o = c * 6, wd = wdist[c], moisture = Math.exp(-wd / 40);
      out[o + 5] = Math.round(moisture * 255);
      if (water.kind[c] !== 0) { out[o + 3] = 255; continue; }
      const dx = (h[jz * grid + jx1] - h[jz * grid + jx0]) / ((jx1 - jx0) * g.cell);
      const dz = (h[jz1 * grid + jx] - h[jz0 * grid + jx]) / ((jz1 - jz0) * g.cell);
      const slope = (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI, height = h[jz * grid + jx];
      // Area membership: 1 inside, 0 outside, blended over `soft` metres across a noise-wobbled outline
      // (small, crisp areas such as the beach wobble less: in proportion to `soft`, in full from 30 m).
      let meadowArea = 0, rockArea = 0, beachArea = 0, wobble = NaN;
      for (const r of areas) {
        if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
        if (wobble !== wobble) wobble = WOBBLE * fbm(n, x / 140, z / 140, 3) + RAGGED * fbm(n, x / 35 + 17.3, z / 35, 3); // broad bays plus a ragged edge
        const s = smoothstep(r.a.soft / 2, -r.a.soft / 2, sdPolygon({ x, z }, r.a.points) + r.wob * wobble);
        if (r.a.kind === 'meadow') meadowArea = Math.max(meadowArea, s);
        else if (r.a.kind === 'rock') rockArea = Math.max(rockArea, s);
        else beachArea = Math.max(beachArea, s);
      }
      const rock = Math.max(smoothstep(36, 48, slope), smoothstep(165, 195, height), rockArea * smoothstep(10, 25, slope));
      const beach = beachArea * smoothstep(70, 25, wd);
      const shore = (1 - rock) * smoothstep(12, 2, wd) * (1 - beach);
      const meadow = meadowArea * (1 - rock) * (1 - shore) * (1 - beach);
      const forest = Math.max(0, 1 - rock - beach - shore - meadow);
      w[0] = forest; w[1] = meadow; w[2] = rock; w[3] = shore; w[4] = beach;
      // Normalise, quantise, and put the rounding error on the biggest weight so the five sum to exactly 255.
      const sum = w[0] + w[1] + w[2] + w[3] + w[4];
      let total = 0, big = 0;
      for (let k = 0; k < 5; k++) {
        const q = Math.round((w[k] / sum) * 255);
        out[o + k] = q; total += q;
        if (q > out[o + big]) big = k;
      }
      out[o + big] += 255 - total;
    }
  }
  return out;
}

/**
 * Per-sample normals and cavity, RGBA8 over the whole height grid. RGB is the unit normal mapped from [-1, 1] to [0, 255];
 * A is cavity: 128 on flat ground, more in hollows, less on bumps.
 */
export function computeNormals(g: HeightGrid): Uint8Array {
  const { grid, h, cell } = g, out = new Uint8Array(grid * grid * 4), q = (v: number) => Math.round((v * 0.5 + 0.5) * 255);
  for (let iz = 0; iz < grid; iz++) {
    const z0 = Math.max(0, iz - 1), z1 = Math.min(grid - 1, iz + 1);
    for (let ix = 0; ix < grid; ix++) {
      const x0 = Math.max(0, ix - 1), x1 = Math.min(grid - 1, ix + 1), c = iz * grid + ix, o = c * 4;
      const dx = (h[iz * grid + x1] - h[iz * grid + x0]) / ((x1 - x0) * cell);
      const dz = (h[z1 * grid + ix] - h[z0 * grid + ix]) / ((z1 - z0) * cell);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      out[o] = q(-dx * inv); out[o + 1] = q(inv); out[o + 2] = q(-dz * inv);
      const ring = h[z0 * grid + x0] + h[z0 * grid + ix] + h[z0 * grid + x1] + h[iz * grid + x0] + h[iz * grid + x1] + h[z1 * grid + x0] + h[z1 * grid + ix] + h[z1 * grid + x1];
      const cav = 0.5 + (ring / 8 - h[c]) * 0.25;
      out[o + 3] = Math.round(Math.min(1, Math.max(0, cav)) * 255);
    }
  }
  return out;
}

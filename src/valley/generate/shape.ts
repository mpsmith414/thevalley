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
/** Ridge cross-section, 1 on the crest to 0 at `t` = 1: a rounded top, steeper upper faces and a concave foot that flares out into the floor. */
const profile = (t: number) => {
  if (t >= 1) return 0;
  const u = t < 0.12 ? (t * t) / 0.24 / 0.94 : (t - 0.06) / 0.94; // eases the crest so it is rounded, not a knife edge
  return 0.55 * (1 - t * t) * (1 - t * t) + 0.45 * (1 - u) ** 3;
};
/** Smooth maximum and minimum of a and b, blended over about k metres. */
const smax = (a: number, b: number, k: number) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
const smin = (a: number, b: number, k: number) => 0.5 * (a + b - Math.sqrt((a - b) * (a - b) + k * k));

/** Crest wander: the ridge and rim distance fields are domain-warped by WARP·fbm (about ±60 m typical, 180 m at most; two octaves, so faces are not squeezed too steep) at WARP_SCALE m. */
const WARP = 250, WARP_SCALE = 600;
/** The warp fades to zero within about PIN m of each viewpoint, so a viewpoint keeps its place on (or off) the ridges. */
const PIN = 160;
/** Spurs and side valleys: ridge distance is scaled by 1 + SPUR·fbm (about ±10%, ±35% at most) at SPUR_SCALE m. */
const SPUR = 0.5, SPUR_SCALE = 150;
/** Crest height varies by 1 + CREST·fbm (about ±17%, ±50% at most) along each ridge. */
const CREST = 0.7, CREST_SCALE = 360;
/** Rolling floor: ROLL_BIAS + ROLL·fbm (about ±6 m, ±20 m at most) at ROLL_SCALE m, plus HUMMOCK·fbm hummocks; faded out near the river and lake. */
const ROLL = 30, ROLL_BIAS = 3, ROLL_SCALE = 300, HUMMOCK = 6, HUMMOCK_SCALE = 45;
/** Around the lake the land rises like the carved shore (0.12 m per m) for 30 m, then at most LAKE_BOWL m per m more, so the hills do not reach the shore. */
const LAKE_BOWL = 0.3;
/** The smooth fields (everything but the detail noise) are computed on a coarser grid about this many metres apart, then interpolated. */
const COARSE = 3.2;

/** Distance from (x, z) to the polyline `pts` (a single point is a zero-length segment). */
function polyDist(pts: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return best;
}

/**
 * The terrain before erosion: a bowl with a raised rim, the layout's ridges on top (max, not sum), and noise that
 * grows with relief, so the floor stays gentle and the hills get rough and rocky. The ridge and rim distance fields
 * are domain-warped so crests wander and faces grow spurs; crest heights vary along each ridge; the floor rolls gently,
 * flattening towards the river and the lake so the carving later blends in.
 */
export function baseShape(layout: Layout, grid: number): HeightGrid {
  const { size, floor, rim, ridges, lake, river } = layout;
  const cell = size / (grid - 1), half = size / 2;
  const h = new Float32Array(grid * grid);
  const n = createNoise2D(layout.seed), n2 = createNoise2D(layout.seed ^ 0x5bd1e995);
  const nwx = createNoise2D(layout.seed ^ 0x2c1b3c6d), nwz = createNoise2D(layout.seed ^ 0x297a2d39);
  const ns = createNoise2D(layout.seed ^ 0x68e31da4), nf = createNoise2D(layout.seed ^ 0x1b873593);
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
  const nr = ridges.length, nseg = segRidge.length;
  // Narrow ridges (the knoll) barely move or change height, so they stay as the layout draws them.
  const warpOf = ridges.map((r) => Math.min(1, (r.width / 200) ** 2));
  const dmin = new Float64Array(nr);
  // The lake as an ellipse (its outline's bounding box): a cheap distance, only used to fade the floor roll.
  let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
  for (const p of lake.outline) { lx0 = Math.min(lx0, p.x); lx1 = Math.max(lx1, p.x); lz0 = Math.min(lz0, p.z); lz1 = Math.max(lz1, p.z); }
  const lcx = (lx0 + lx1) / 2, lcz = (lz0 + lz1) / 2, lrx = (lx1 - lx0) / 2, lrz = (lz1 - lz0) / 2, lr = Math.min(lrx, lrz);

  const warpAt = (x: number, z: number) => [WARP * fbm(nwx, x / WARP_SCALE, z / WARP_SCALE, 2), WARP * fbm(nwz, x / WARP_SCALE, z / WARP_SCALE, 2)];
  const pins = layout.viewpoints.map((v) => [v.pos.x, v.pos.z, ...warpAt(v.pos.x, v.pos.z)]);

  // 1. Smooth fields on the coarse grid: land (rim + ridges), rockiness, floor roll and the warped detail-noise domain.
  const cs = Math.max(1, Math.round(COARSE / cell)), cg = Math.ceil((grid - 1) / cs) + 1, cc = cs * cell;
  const F = 5, field = new Float32Array(cg * cg * F);
  for (let jz = 0; jz < cg; jz++) {
    const z = -half + jz * cc;
    for (let jx = 0; jx < cg; jx++) {
      const x = -half + jx * cc;
      let [wx, wz] = warpAt(x, z);
      for (const [px, pz, pwx, pwz] of pins) {
        const e = Math.exp(-((x - px) ** 2 + (z - pz) ** 2) / (PIN * PIN));
        wx -= pwx * e; wz -= pwz * e;
      }
      // Rim: a rounded square (superellipse) on the warped coordinates, so the bowl has no straight edge.
      const ux = Math.abs(x + wx) / half, uz = Math.abs(z + wz) / half;
      let land = rim * smoothstep(0.55, 1.05, Math.sqrt(Math.sqrt(Math.sqrt(ux ** 8 + uz ** 8)))) * (1 + 0.9 * fbm(ns, x / 400 + 11.3, z / 400, 2));
      dmin.fill(Infinity);
      for (let s = 0; s < nseg; s++) {
        const k = segRidge[s], px = x + warpOf[k] * wx, pz = z + warpOf[k] * wz;
        const ax = segs[s * 4], az = segs[s * 4 + 1], dx = segs[s * 4 + 2], dz = segs[s * 4 + 3], l2 = dx * dx + dz * dz;
        const t = l2 < 1e-12 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / l2));
        const d = Math.sqrt((px - ax - t * dx) ** 2 + (pz - az - t * dz) ** 2);
        if (d < dmin[k]) dmin[k] = d;
      }
      const spur = SPUR * fbm(ns, x / SPUR_SCALE, z / SPUR_SCALE, 3);
      let up = 0, rocky = 0;
      for (let k = 0; k < nr; k++) {
        const r = ridges[k], t = dmin[k] / r.width;
        // Spurs: stretch or squeeze the distance on the faces, tapering to nothing at the foot so no stray islands appear.
        const b = profile(t * Math.max(0.5, 1 + spur * smoothstep(1, 0.5, t)));
        if (b === 0) continue;
        const crest = 1 + CREST * warpOf[k] * fbm(nf, x / CREST_SCALE + 37.1 * k, z / CREST_SCALE - 11.7 * k, 2);
        up = Math.max(up, r.height * crest * b);
        rocky = Math.max(rocky, r.rocky * b);
      }
      land += up;
      const dLake = (Math.hypot((x - lcx) / lrx, (z - lcz) / lrz) - 1) * lr, dRiver = polyDist(river.points, x, z);
      const dl = Math.max(0, dLake - 20); // the ellipse is only roughly the shore, so measure conservatively
      land = smin(land, 1 + 0.12 * dl + LAKE_BOWL * Math.max(0, dl - 30), 4); // the hills step back from the lake: a basin, not a wall at the shore
      const fade = smoothstep(10, 140, dRiver) * smoothstep(20, 160, dLake);
      const roll = fade * (ROLL_BIAS + ROLL * fbm(nf, x / ROLL_SCALE, z / ROLL_SCALE, 3) + HUMMOCK * fbm(nf, x / HUMMOCK_SCALE + 51.3, z / HUMMOCK_SCALE, 2));
      const o = (jz * cg + jx) * F;
      field[o] = land;
      field[o + 1] = rocky;
      field[o + 2] = smax(roll, -1.8, 3); // soft floor, so hollows level out above the lake instead of being clamped flat
      // Detail noise runs on a gently warped domain, so the rough faces do not line up.
      field[o + 3] = x + 0.4 * wx + 30 * fbm(ns, x / 110 + 7.7, z / 110, 2);
      field[o + 4] = z + 0.4 * wz + 30 * fbm(ns, x / 110, z / 110 - 7.7, 2);
    }
  }

  // 2. Full resolution: interpolate the smooth fields and add the detail noise.
  const v = new Float64Array(F);
  for (let iz = 0; iz < grid; iz++) {
    const fz = iz / cs, jz = Math.min(cg - 2, Math.floor(fz)), tz = fz - jz;
    for (let ix = 0; ix < grid; ix++) {
      const fx = ix / cs, jx = Math.min(cg - 2, Math.floor(fx)), tx = fx - jx;
      const o00 = (jz * cg + jx) * F, o10 = o00 + F, o01 = o00 + cg * F, o11 = o01 + F;
      for (let f = 0; f < F; f++) {
        const a = field[o00 + f] + (field[o10 + f] - field[o00 + f]) * tx, b = field[o01 + f] + (field[o11 + f] - field[o01 + f]) * tx;
        v[f] = a + (b - a) * tz;
      }
      const land = v[0], rocky = v[1], relief = smoothstep(2, 30, land), mx = v[3], mz = v[4];
      let y = floor + land + v[2] + (1.5 + 10 * relief) * fbm(n, mx / 220, mz / 220, 5);
      if (rocky > 0 && relief > 0) y += rocky * 18 * relief * ridged(n2, mx / 90, mz / 90, 4);
      h[iz * grid + ix] = y;
    }
  }
  return { grid, size, cell, h };
}

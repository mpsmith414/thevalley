import type { Layout, Pt } from '../types';
import { buildPolylineIndex, catmullRom, nearestOnPolyline, pointInPolygon, sdPolygon } from '../geom';
import { sampleHeight, type HeightGrid } from './shape';

/** One point of the river course (every 2 m): where it is, how high the water stands, how wide and steep it is, and which way it runs. */
export type RiverSample = { x: number; z: number; s: number; surface: number; width: number; slope: number; tx: number; tz: number };
/** Water on the map grid. `level` is NaN where dry, `flow` holds x, z in m/s per cell, `kind` is 0 dry, 1 lake, 2 river. */
export type WaterMaps = { mapGrid: number; level: Float32Array; flow: Float32Array; kind: Uint8Array };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Walk down the course so the water surface never rises and ends at the lake level. */
function riverProfile(g: HeightGrid, layout: Layout): RiverSample[] {
  const { river, lake } = layout;
  const cs = catmullRom(river.points, 2), n = cs.length, total = cs[n - 1].s || 1;
  const surface = new Float64Array(n), raw = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const { p, s } = cs[k], t = sampleHeight(g, p.x, p.z) - 0.3;
    if (k === n - 1 || sdPolygon(p, lake.outline) < 0) surface[k] = lake.level;
    else surface[k] = Math.max(lake.level, k === 0 ? t : Math.min(surface[k - 1] - 0.002 * (s - cs[k - 1].s), t));
  }
  for (let k = 1; k < n; k++) raw[k] = (surface[k - 1] - surface[k]) / ((cs[k].s - cs[k - 1].s) || 1);
  raw[0] = n > 1 ? raw[1] : 0;
  return cs.map((q, k) => {
    let sum = 0, c = 0;
    for (let j = Math.max(0, k - 3); j <= Math.min(n - 1, k + 3); j++) { sum += raw[j]; c++; }
    return {
      x: q.p.x, z: q.p.z, s: q.s, surface: surface[k], width: river.width0 + (river.width1 - river.width0) * (q.s / total),
      slope: sum / c, tx: q.t.x, tz: q.t.z,
    };
  });
}

/** Index range of the grid cells covering [x0, x1] x [z0, z1] (clamped to the grid). */
function cellRange(g: HeightGrid, x0: number, x1: number, z0: number, z1: number) {
  const half = g.size / 2, max = g.grid - 1, f = (v: number, lo: boolean) => clamp(lo ? Math.ceil((v + half) / g.cell) : Math.floor((v + half) / g.cell), 0, max);
  return { i0: f(x0, true), i1: f(x1, false), j0: f(z0, true), j1: f(z1, false) };
}

const bounds = (pts: Pt[], pad: number) => ({
  x0: Math.min(...pts.map((p) => p.x)) - pad, x1: Math.max(...pts.map((p) => p.x)) + pad,
  z0: Math.min(...pts.map((p) => p.z)) - pad, z1: Math.max(...pts.map((p) => p.z)) + pad,
});

/**
 * Cut the river and the lake into the (eroded) terrain so the river always runs downhill into the lake,
 * and build the water maps on the map grid. Mutates `g.h`.
 */
export function carveWater(g: HeightGrid, layout: Layout): { river: RiverSample[]; water: WaterMaps } {
  const { lake, river: course, areas } = layout, level = lake.level;
  const river = riverProfile(g, layout);
  const grid = g.grid, half = g.size / 2, h = g.h;
  const index = buildPolylineIndex(river.map((r) => ({ p: { x: r.x, z: r.z }, s: r.s, t: { x: r.tx, z: r.tz } })));
  const channel = new Uint8Array(grid * grid), inLake = new Uint8Array(grid * grid);
  const nearest = new Int32Array(grid * grid).fill(-1); // only filled for channel cells

  // 2. River bed and banks, only where a sample can be near enough (a bucket mask skips the far cells cheaply).
  const reach = Math.max(course.width0, course.width1) / 2 + 8, R = Math.ceil(reach / index.bucket);
  const mw = index.w + 2 * R, mh = index.h + 2 * R, near = new Uint8Array(mw * mh);
  for (let bz = 0; bz < index.h; bz++) for (let bx = 0; bx < index.w; bx++) {
    if (!index.cells[bz * index.w + bx]) continue;
    for (let dz = 0; dz <= 2 * R; dz++) for (let dx = 0; dx <= 2 * R; dx++) near[(bz + dz) * mw + bx + dx] = 1;
  }
  const b = bounds(river, reach), rb = cellRange(g, b.x0, b.x1, b.z0, b.z1);
  for (let iz = rb.j0; iz <= rb.j1; iz++) {
    const z = -half + iz * g.cell, bz = Math.floor(z / index.bucket) - index.minCz + R;
    if (bz < 0 || bz >= mh) continue;
    for (let ix = rb.i0; ix <= rb.i1; ix++) {
      const x = -half + ix * g.cell, bx = Math.floor(x / index.bucket) - index.minCx + R;
      if (bx < 0 || bx >= mw || !near[bz * mw + bx]) continue;
      const { i: k, d } = nearestOnPolyline({ x, z }, index);
      const r = river[k], w2 = r.width / 2, c = iz * grid + ix;
      if (d < w2) {
        h[c] = Math.min(h[c], r.surface - course.depth * (1 - (d / w2) ** 2) - 0.05);
        channel[c] = 1; nearest[c] = k;
      } else if (d < w2 + 8) h[c] = Math.min(h[c], r.surface + 0.3 + (d - w2) * 0.35);
    }
  }

  // 3. Lake basin, and 4. beach: only within 60 m of the outline (everything farther is dry by definition).
  const beach = areas.find((a) => a.kind === 'beach');
  const lb = bounds(lake.outline, 60), bb = beach ? bounds(beach.points, 0) : lb;
  const lr = cellRange(g, Math.min(lb.x0, bb.x0), Math.max(lb.x1, bb.x1), Math.min(lb.z0, bb.z0), Math.max(lb.z1, bb.z1));
  for (let iz = lr.j0; iz <= lr.j1; iz++) for (let ix = lr.i0; ix <= lr.i1; ix++) {
    const p = { x: -half + ix * g.cell, z: -half + iz * g.cell }, sd = sdPolygon(p, lake.outline), c = iz * grid + ix;
    if (sd < 0) {
      inLake[c] = 1;
      h[c] = Math.min(h[c], level - 0.3 - (lake.depth - 0.3) * smoothstep(0, 60, -sd));
    } else if (sd < 60) {
      if (sd < 40) h[c] = Math.min(h[c], level + 0.2 + sd * 0.12);
      if (beach && pointInPolygon(p, beach.points)) h[c] = Math.min(h[c], level + 0.15 + sd * 0.05);
    }
  }

  // 5. Dry land stays dry.
  for (let c = 0; c < h.length; c++) if (!inLake[c] && !channel[c]) h[c] = Math.max(h[c], level + 0.2);

  // Water maps at the map-cell centres (every second height sample).
  const m = (grid - 1) / 2 + 1, levelMap = new Float32Array(m * m).fill(NaN), flow = new Float32Array(m * m * 2), kind = new Uint8Array(m * m);
  for (let iz = 0; iz < m; iz++) for (let ix = 0; ix < m; ix++) {
    const c = iz * m + ix, gc = 2 * iz * grid + 2 * ix;
    if (inLake[gc]) { kind[c] = 1; levelMap[c] = level; } else if (channel[gc]) {
      const r = river[nearest[gc]], speed = clamp(0.4 + 6 * r.slope, 0.4, 2.5);
      kind[c] = 2; levelMap[c] = r.surface; flow[2 * c] = r.tx * speed; flow[2 * c + 1] = r.tz * speed;
    }
  }
  return { river, water: { mapGrid: m, level: levelMap, flow, kind } };
}

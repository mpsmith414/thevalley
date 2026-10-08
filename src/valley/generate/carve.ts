import type { Layout, Pt } from '../types';
import { buildPolylineIndex, catmullRom, nearestOnPolyline, sdPolygon } from '../geom';
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
/** River banks reach BANK m past the water's edge and the lake shore SHORE m from the outline; then they blend back into the terrain over BLEND m. */
const BANK = 8, SHORE = 40, BLEND = 16;
/**
 * Metres the ground sits below the water just inside the shore and above it just outside. Small, so the ground runs
 * through the waterline as one gentle slope: a step there would follow the height grid and draw a stair-stepped shore.
 */
const EDGE = 0.02;
/** Slope of the lake's shelf just inside the shore (it meets the old basin profile 0.3 m down). */
const SHELF = 0.08;
/** Metres of bank beside the river kept above the water (rising 6%: a low levee only where the ground falls away). */
const LEVEE = 3;
/** Lower `h` to `cap`, fully up to the edge of the zone (`past` <= 0) and fading out over BLEND m past it, so no cliff forms at the edge. */
const cut = (h: number, cap: number, past: number) => (h <= cap ? h : past <= 0 ? cap : cap + (h - cap) * smoothstep(0, BLEND, past));

/** Walk down the course so the water surface never rises and ends at the lake level. */
function riverProfile(g: HeightGrid, layout: Layout): RiverSample[] {
  const { river, lake } = layout;
  const cs = catmullRom(river.points, 2), n = cs.length, total = cs[n - 1].s || 1;
  const surface = new Float64Array(n), raw = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const { p, s } = cs[k], sd = sdPolygon(p, lake.outline);
    // below the ground, and below the lake's shore, which is lowered to a gentle slope later
    const t = Math.min(sampleHeight(g, p.x, p.z), sd < SHORE ? lake.level + EDGE + Math.max(0, sd) * 0.12 : Infinity) - 0.3;
    if (k === n - 1 || sd < 0) surface[k] = lake.level;
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

/**
 * Where `p` sits against the course near sample `k`: its distance square to the course (to the nearer of the two segments
 * either side of `k`), and the water surface and width there, interpolated along that segment. Measuring to the sample
 * points instead would scallop the banks every 2 m, and taking the nearest sample's surface would terrace a steep bed.
 */
export function onCourse(p: Pt, river: RiverSample[], k: number): { d: number; surface: number; width: number } {
  let best = { d: Infinity, surface: river[k].surface, width: river[k].width };
  for (const j of [k - 1, k]) {
    const a = river[j], b = river[j + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 < 1e-12 ? 0 : clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1);
    const d = Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
    if (d < best.d) best = { d, surface: a.surface + (b.surface - a.surface) * t, width: a.width + (b.width - a.width) * t };
  }
  if (best.d === Infinity) best.d = Math.hypot(p.x - river[k].x, p.z - river[k].z); // a single sample
  return best;
}

/**
 * Signed distance to a polygon (negative inside), row by row, for many queries: `rows(z)` returns `sd(x)` along that row.
 * The sign is exactly `pointInPolygon`'s (same crossings); the distance is exact wherever it is below `band` and at least
 * `band` elsewhere, because only edges whose box comes within `band` of the row and of x are measured.
 */
function outlineRows(poly: Pt[], band: number): (z: number) => (x: number) => number {
  const n = poly.length;
  return (z) => {
    const xs: number[] = [], near: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.z > z !== b.z > z) xs.push(((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x);
      if (Math.min(a.z, b.z) - band <= z && z <= Math.max(a.z, b.z) + band) near.push(j, i);
    }
    return (x) => {
      let inside = false, d2 = band * band;
      for (const cx of xs) if (x < cx) inside = !inside;
      for (let k = 0; k < near.length; k += 2) {
        const a = poly[near[k]], b = poly[near[k + 1]];
        if (x < Math.min(a.x, b.x) - band || x > Math.max(a.x, b.x) + band) continue;
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
        const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
        const ex = x - (a.x + t * dx), ez = z - (a.z + t * dz);
        d2 = Math.min(d2, ex * ex + ez * ez);
      }
      const d = Math.sqrt(d2);
      return inside ? -d : d;
    };
  };
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
  const nearest = new Int32Array(grid * grid).fill(-1), surf = new Float32Array(grid * grid); // only filled for channel cells
  const bankFloor = new Float32Array(grid * grid).fill(-Infinity); // the least height of the banks, applied after the lake

  // 2. River bed and banks, only where a sample can be near enough (a bucket mask skips the far cells cheaply).
  const reach = Math.max(course.width0, course.width1) / 2 + BANK + BLEND, R = Math.ceil(reach / index.bucket);
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
      const { i: k } = nearestOnPolyline({ x, z }, index);
      const { d, surface, width } = onCourse({ x, z }, river, k), w2 = width / 2, c = iz * grid + ix;
      if (d < w2) {
        h[c] = Math.min(h[c], surface - course.depth * (1 - (d / w2) ** 2) - EDGE);
        channel[c] = 1; nearest[c] = k; surf[c] = surface;
      } else if (d < w2 + BANK + BLEND) {
        h[c] = cut(h[c], surface + EDGE + (d - w2) * 0.35, d - w2 - BANK);
        // where the ground falls away (across a hillside, or the lowered lake shore) the bank still holds the water
        const f = surface + EDGE + Math.min(d - w2, LEVEE) * 0.06 - Math.max(0, d - w2 - LEVEE) * 0.5;
        bankFloor[c] = Math.max(bankFloor[c], f);
      }
    }
  }

  // 3. Lake basin, and 4. beach: only within 60 m of the outline (everything farther is dry by definition).
  const beach = areas.find((a) => a.kind === 'beach');
  const lb = bounds(lake.outline, 60), bb = beach ? bounds(beach.points, BLEND) : lb;
  const lr = cellRange(g, Math.min(lb.x0, bb.x0), Math.max(lb.x1, bb.x1), Math.min(lb.z0, bb.z0), Math.max(lb.z1, bb.z1));
  const sdLake = outlineRows(lake.outline, 60);
  for (let iz = lr.j0; iz <= lr.j1; iz++) {
    const row = sdLake(-half + iz * g.cell);
    for (let ix = lr.i0; ix <= lr.i1; ix++) {
      const p = { x: -half + ix * g.cell, z: -half + iz * g.cell }, sd = row(p.x), c = iz * grid + ix;
      if (sd < 0) {
        inLake[c] = 1;
        h[c] = Math.min(h[c], level - EDGE - Math.min(-sd * SHELF, 0.3 - EDGE) - (lake.depth - 0.3) * smoothstep(0, 60, -sd));
      } else if (sd < 60) {
        if (sd < SHORE + BLEND) h[c] = cut(h[c], level + EDGE + sd * 0.12, sd - SHORE);
        const sb = beach ? sdPolygon(p, beach.points) : Infinity;
        if (sb < BLEND) h[c] = cut(h[c], level + EDGE + sd * 0.05, sb);
      }
    }
  }

  // 5. Dry land stays dry, and the river's banks hold it.
  for (let c = 0; c < h.length; c++) if (!inLake[c] && !channel[c]) h[c] = Math.max(h[c], level + EDGE, bankFloor[c]);

  // Water maps at the map-cell centres (every second height sample).
  const m = (grid - 1) / 2 + 1, levelMap = new Float32Array(m * m).fill(NaN), flow = new Float32Array(m * m * 2), kind = new Uint8Array(m * m);
  for (let iz = 0; iz < m; iz++) for (let ix = 0; ix < m; ix++) {
    const c = iz * m + ix, gc = 2 * iz * grid + 2 * ix;
    if (inLake[gc]) { kind[c] = 1; levelMap[c] = level; } else if (channel[gc]) {
      const r = river[nearest[gc]], speed = clamp(0.4 + 6 * r.slope, 0.4, 2.5);
      kind[c] = 2; levelMap[c] = surf[gc]; flow[2 * c] = r.tx * speed; flow[2 * c + 1] = r.tz * speed;
    }
  }
  return { river, water: { mapGrid: m, level: levelMap, flow, kind } };
}

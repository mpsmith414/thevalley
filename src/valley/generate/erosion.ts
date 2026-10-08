import { mulberry32 } from '../../util/rng';
import type { HeightGrid } from './shape';

const INERTIA = 0.05, CAPACITY = 4, MIN_SLOPE = 0.01, ERODE = 0.3, DEPOSIT = 0.3, EVAPORATE = 0.02, GRAVITY = 4, MAX_STEPS = 64;
/** Changed from the Beyer defaults: brush radius 3 (was 2), so each droplet cuts a smoother channel and trenches stay shallower. */
const RADIUS = 3;
/**
 * Droplets per half-resolution cell. Changed from 0.7: with heights in metres the slopes here are far steeper than
 * Beyer's defaults assume, so droplets reach high speed and 0.7/cell cut trenches over 100 m deep (grid 257) and moved
 * the mean land height by -4 m. At 0.02/cell the gullies are still plain to see (about a quarter of the cells in the hills
 * drop more than 1 m at grid 2049) and the deepest cut is about 10 m.
 */
const DROPLETS_PER_CELL = 0.02;

/** Despike margin: after erosion no sample stands more than this above (or below) all 8 of its neighbours. */
const SPIKE = 0.25;

/**
 * Clamp every sample to [min − SPIKE, max + SPIKE] of its 8 neighbours (read from a copy, so the order does not matter).
 * Deposits land on single samples, and this flattens the needles they leave without touching gullies or slopes.
 * It is a single Jacobi pass, so two adjacent spikes support each other and may need a second pass.
 */
export function despike(h: Float32Array, grid: number, margin = SPIKE): void {
  const src = h.slice();
  for (let iz = 1; iz < grid - 1; iz++)
    for (let ix = 1; ix < grid - 1; ix++) {
      const c = iz * grid + ix;
      let lo = Infinity, hi = -Infinity;
      for (const o of [c - grid - 1, c - grid, c - grid + 1, c - 1, c + 1, c + grid - 1, c + grid, c + grid + 1]) {
        const v = src[o];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      h[c] = Math.min(hi + margin, Math.max(lo - margin, src[c]));
    }
}

/**
 * Beyer-style droplet erosion, in place. Droplets roll downhill carving gullies and dropping scree fans.
 * It runs on a half-resolution copy (every second sample, finer droplet coverage than at full resolution for the
 * same cost); the bilinearly upsampled change is then added to the full grid, so full-resolution detail
 * stays and the carving is layered on top. Both grids are despiked afterwards. `g.grid` must be odd.
 */
export function erode(g: HeightGrid, seed: number, droplets?: number): void {
  const { grid, h } = g, m = (grid - 1) / 2 + 1;
  if ((grid - 1) % 2) throw new Error(`erode needs an odd grid size, got ${grid}`);
  const half = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) half[j * m + i] = h[2 * j * grid + 2 * i];
  const before = half.slice();
  simulate(half, m, seed, droplets ?? Math.round(DROPLETS_PER_CELL * m * m));
  despike(half, m); // a needle here would upsample into a bump too wide for the full-resolution pass
  for (let i = 0; i < half.length; i++) half[i] -= before[i]; // now the change
  blur121(half, m); // soften the change once, so deposits do not upsample into little pyramids
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const k = j * m + i, d00 = half[k], o = 2 * j * grid + 2 * i;
      h[o] += d00;
      if (i < m - 1) h[o + 1] += (d00 + half[k + 1]) / 2;
      if (j < m - 1) {
        h[o + grid] += (d00 + half[k + m]) / 2;
        if (i < m - 1) h[o + grid + 1] += (d00 + half[k + 1] + half[k + m] + half[k + m + 1]) / 4;
      }
    }
  despike(h, grid);
}

/** One pass of a separable [1 2 1] / 4 blur over a square grid, in place (edges use the nearest sample). */
function blur121(a: Float32Array, m: number): void {
  const t = new Float32Array(a.length);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = j * m + i;
    t[k] = (a[k - (i > 0 ? 1 : 0)] + 2 * a[k] + a[k + (i < m - 1 ? 1 : 0)]) / 4;
  }
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = j * m + i;
    a[k] = (t[k - (j > 0 ? m : 0)] + 2 * t[k] + t[k + (j < m - 1 ? m : 0)]) / 4;
  }
}

/**
 * The droplet simulation on a square grid of `grid` samples, in cell units. A droplet that stops (flat ground),
 * leaves the grid or runs out of MAX_STEPS loses its remaining sediment (it is never deposited), which is why the mean height
 * drifts slightly negative instead of being exactly conserved.
 */
function simulate(h: Float32Array, grid: number, seed: number, droplets: number): void {
  const max = grid - 1;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  // Brush: cells within RADIUS of the droplet, weighted by closeness, summing to 1.
  const bx: number[] = [], bz: number[] = [], bw: number[] = [];
  let total = 0;
  for (let dz = -RADIUS; dz <= RADIUS; dz++)
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const w = RADIUS - Math.sqrt(dx * dx + dz * dz);
      if (w > 0) { bx.push(dx); bz.push(dz); bw.push(w); total += w; }
    }
  const nb = bw.length;
  for (let i = 0; i < nb; i++) bw[i] /= total;
  const brushOff = Int32Array.from(bx.map((dx, i) => bz[i] * grid + dx)), brushW = Float64Array.from(bw);

  for (let d = 0; d < droplets; d++) {
    let px = rng() * (max - 1), pz = rng() * (max - 1), dirX = 0, dirZ = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      const ix = Math.floor(px), iz = Math.floor(pz), fx = px - ix, fz = pz - iz, i = iz * grid + ix;
      const h00 = h[i], h10 = h[i + 1], h01 = h[i + grid], h11 = h[i + grid + 1];
      const gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz, gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const hOld = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
      dirX = dirX * INERTIA - gx * (1 - INERTIA);
      dirZ = dirZ * INERTIA - gz * (1 - INERTIA);
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
      if (len < 1e-9) break;
      dirX /= len; dirZ /= len;
      const nx = px + dirX, nz = pz + dirZ;
      if (nx < 0 || nx >= max || nz < 0 || nz >= max) break;
      // Height at the new position.
      const jx = Math.floor(nx), jz = Math.floor(nz), tx = nx - jx, tz = nz - jz, j = jz * grid + jx;
      const hNew = h[j] * (1 - tx) * (1 - tz) + h[j + 1] * tx * (1 - tz) + h[j + grid] * (1 - tx) * tz + h[j + grid + 1] * tx * tz;
      const dh = hNew - hOld;
      const cap = Math.max(-dh, MIN_SLOPE) * speed * water * CAPACITY;
      if (sediment > cap || dh > 0) {
        // Uphill: fill the dip behind us (at most up to the new height); otherwise drop the excess.
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * DEPOSIT;
        sediment -= amount;
        h[i] += amount * (1 - fx) * (1 - fz);
        h[i + 1] += amount * fx * (1 - fz);
        h[i + grid] += amount * (1 - fx) * fz;
        h[i + grid + 1] += amount * fx * fz;
      } else if (ix >= RADIUS && ix < max - RADIUS && iz >= RADIUS && iz < max - RADIUS) {
        const amount = Math.min((cap - sediment) * ERODE, -dh);
        for (let b = 0; b < nb; b++) h[i + brushOff[b]] -= amount * brushW[b];
        sediment += amount;
      }
      // dh is negative downhill, so subtracting it speeds the droplet up going down and slows it going up.
      speed = Math.sqrt(Math.max(0, speed * speed - dh * GRAVITY));
      water *= 1 - EVAPORATE;
      px = nx; pz = nz;
    }
  }
}

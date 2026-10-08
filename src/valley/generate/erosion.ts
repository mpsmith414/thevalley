import { mulberry32 } from '../../util/rng';
import type { HeightGrid } from './shape';

const INERTIA = 0.05, CAPACITY = 4, MIN_SLOPE = 0.01, ERODE = 0.3, DEPOSIT = 0.3, EVAPORATE = 0.02, GRAVITY = 4, MAX_STEPS = 64, RADIUS = 2;

/**
 * Beyer-style droplet erosion, in place. Each droplet rolls downhill, picking up sediment where it is
 * fast and dropping it where it slows, which carves gullies and softens spikes. Work is in grid-cell units.
 */
export function erode(g: HeightGrid, seed: number, droplets = Math.round(160_000 * ((g.grid - 1) / 2048) ** 2)): void {
  const { grid, h } = g, max = grid - 1;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  // Brush: cells within RADIUS of the droplet, weighted by closeness, summing to 1.
  const bx: number[] = [], bz: number[] = [], bw: number[] = [];
  let total = 0;
  for (let dz = -RADIUS; dz <= RADIUS; dz++)
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const w = RADIUS - Math.hypot(dx, dz);
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
      const len = Math.hypot(dirX, dirZ);
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
      speed = Math.sqrt(Math.max(0, speed * speed + dh * GRAVITY));
      water *= 1 - EVAPORATE;
      px = nx; pz = nz;
    }
  }
}

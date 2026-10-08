import type { Vec3 } from '../util/vec';
import { buildPolylineIndex, nearestOnPolyline } from './geom';
import type { RiverSample } from './generate/carve';
import { sampleHeight, type HeightGrid } from './generate/shape';
import { TILE_SIZE, TILES, type Biomes, type Pt, type ValleyData } from './types';

/** What every system asks about the ground, the water and the biomes. All positions are world metres (x east, z south). */
export interface Valley {
  readonly size: number;
  /** Bilinear on the height grid. */
  heightAt(x: number, z: number): number;
  /** Unit normal, from central differences on `heightAt` one cell apart. */
  normalAt(x: number, z: number): Vec3;
  /** True where the nearest map cell holds water (lake or river). */
  isWater(x: number, z: number): boolean;
  /** Water surface height at the nearest map cell, NaN on dry land. */
  waterLevelAt(x: number, z: number): number;
  /** `max(0, level - height)`, 0 on dry land. */
  waterDepthAt(x: number, z: number): number;
  /** Biome weights (0-1), bilinear on the map grid. */
  biomeAt(x: number, z: number): Biomes;
  /** 0 (dry) to 1 (at the water), bilinear on the map grid. */
  moistureAt(x: number, z: number): number;
  /** Current in m/s at the nearest map cell; `{ x: 0, z: 0 }` off the river. */
  flowAt(x: number, z: number): Pt;
  /** Distance to the nearest river sample, and that sample. */
  distanceToRiver(x: number, z: number): { d: number; sample: RiverSample };
  /** Trunks (from the tiles' lists) whose circle comes within `r` metres of the point. */
  trunksNear(x: number, z: number, r: number): { x: number; z: number; r: number }[];
  /** True inside the valley square, shrunk by `margin` metres. */
  inside(x: number, z: number, margin?: number): boolean;
}

/** Build the query object over generated `ValleyData`. */
export function createValley(d: ValleyData): Valley {
  const { size } = d, half = size / 2, grid: HeightGrid = { grid: d.grid, size, cell: size / (d.grid - 1), h: d.height };
  const m = d.water.mapGrid, mapCell = size / (m - 1), { kind, level, flow } = d.water;
  const index = buildPolylineIndex(d.river.map((r) => ({ p: { x: r.x, z: r.z }, s: r.s, t: { x: r.tx, z: r.tz } })));
  const tileAt = new Map<number, Float32Array>(); // tile number -> trunk triples
  for (const t of d.tiles) if (t.trunks.length) tileAt.set(t.tz * TILES + t.tx, t.trunks);

  /** Nearest map node index. */
  const node = (x: number, z: number) => {
    const ix = Math.min(m - 1, Math.max(0, Math.round((x + half) / mapCell))), iz = Math.min(m - 1, Math.max(0, Math.round((z + half) / mapCell)));
    return iz * m + ix;
  };
  /** Bilinear read of channel `ch` of `stride` bytes per cell, in 0-1. */
  const bilinear = (x: number, z: number, ch: number, stride: number) => {
    const fx = Math.min(m - 1, Math.max(0, (x + half) / mapCell)), fz = Math.min(m - 1, Math.max(0, (z + half) / mapCell));
    const ix = Math.min(m - 2, Math.floor(fx)), iz = Math.min(m - 2, Math.floor(fz)), tx = fx - ix, tz = fz - iz;
    const c = (iz * m + ix) * stride + ch, b = d.biomes;
    const a0 = b[c] + (b[c + stride] - b[c]) * tx, a1 = b[c + m * stride] + (b[c + (m + 1) * stride] - b[c + m * stride]) * tx;
    return (a0 + (a1 - a0) * tz) / 255;
  };
  const heightAt = (x: number, z: number) => sampleHeight(grid, x, z);
  const levelAt = (x: number, z: number) => level[node(x, z)];

  return {
    size,
    heightAt,
    normalAt(x, z) {
      const e = grid.cell, dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      return { x: -dx * inv, y: inv, z: -dz * inv };
    },
    isWater: (x, z) => kind[node(x, z)] !== 0,
    waterLevelAt: levelAt,
    waterDepthAt(x, z) {
      const l = levelAt(x, z);
      return l === l ? Math.max(0, l - heightAt(x, z)) : 0;
    },
    biomeAt: (x, z) => ({
      forest: bilinear(x, z, 0, 6), meadow: bilinear(x, z, 1, 6), rock: bilinear(x, z, 2, 6), shore: bilinear(x, z, 3, 6), beach: bilinear(x, z, 4, 6),
    }),
    moistureAt: (x, z) => bilinear(x, z, 5, 6),
    flowAt(x, z) {
      const c = node(x, z);
      return { x: flow[2 * c], z: flow[2 * c + 1] };
    },
    distanceToRiver(x, z) {
      const { i, d: dist } = nearestOnPolyline({ x, z }, index);
      return { d: dist, sample: d.river[i] };
    },
    trunksNear(x, z, r) {
      const out: { x: number; z: number; r: number }[] = [];
      if (tileAt.size === 0) return out;
      const t = (v: number) => Math.floor((v + half) / TILE_SIZE);
      // A trunk's own radius is under 4 m; look that far beyond r when choosing tiles.
      const tx0 = Math.max(0, t(x - r - 4)), tx1 = Math.min(TILES - 1, t(x + r + 4)), tz0 = Math.max(0, t(z - r - 4)), tz1 = Math.min(TILES - 1, t(z + r + 4));
      for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
        const list = tileAt.get(tz * TILES + tx);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 3) {
          if (Math.hypot(list[k] - x, list[k + 1] - z) <= r + list[k + 2]) out.push({ x: list[k], z: list[k + 1], r: list[k + 2] });
        }
      }
      return out;
    },
    inside: (x, z, margin = 0) => Math.abs(x) <= half - margin && Math.abs(z) <= half - margin,
  };
}

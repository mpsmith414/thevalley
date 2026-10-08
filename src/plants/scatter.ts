/** Seeded scattering of trees, shrubs and props over the Valley, one 64 m tile at a time. */
import { hash } from '../util/hash';
import { mulberry32 } from '../util/rng';
import type { Valley } from '../valley/valley';
import { INSTANCE_STRIDE, TILE_SIZE, TILES, WORLD_SIZE, type TileData } from '../valley/types';
import { PLANT_KINDS, SPECIES, TREE_KINDS, type PlantKind, type SiteInfo } from './species';

/** Tile area in hectares (0.4096). */
const HA = (TILE_SIZE * TILE_SIZE) / 10_000;
/** Order the kinds are placed in: big things first, so the small ones keep clear of them. */
const ORDER: PlantKind[] = ['pine', 'spruce', 'birch', 'alder', 'willow', 'boulder', 'log', 'stump', 'juniper', 'blueberry', 'fern'];
/** Kinds that stand in the way: other kinds stay `CLEARANCE` metres from them. */
const BEARING = new Set<PlantKind>([...TREE_KINDS, 'boulder', 'log', 'stump']);
const CLEARANCE = 1.2, BUCKET = 4, BUCKETS = TILE_SIZE / BUCKET;
const LOG_LENGTH = 8, LOG_RADIUS = 0.35; // the spec's mean log length, and the radius of each circle along it
const RAD2DEG = 180 / Math.PI;

/** Points kept so far in one tile, found quickly through a grid of `BUCKET` m cells. */
class Points {
  private head = new Int32Array(BUCKETS * BUCKETS).fill(-1);
  private next: number[] = [];
  private xs: number[] = [];
  private zs: number[] = [];
  private cell(v: number) { return Math.min(BUCKETS - 1, Math.max(0, Math.floor(v / BUCKET))); }
  add(x: number, z: number) {
    const c = this.cell(z) * BUCKETS + this.cell(x), i = this.xs.length;
    this.xs.push(x); this.zs.push(z); this.next.push(this.head[c]); this.head[c] = i;
  }
  /** True when a kept point is closer than `r` to (x, z). Positions are tile-local. */
  near(x: number, z: number, r: number) {
    const r2 = r * r, x1 = this.cell(x + r), z1 = this.cell(z + r);
    for (let cz = this.cell(z - r); cz <= z1; cz++) for (let cx = this.cell(x - r); cx <= x1; cx++) {
      for (let i = this.head[cz * BUCKETS + cx]; i >= 0; i = this.next[i]) {
        const dx = this.xs[i] - x, dz = this.zs[i] - z;
        if (dx * dx + dz * dz < r2) return true;
      }
    }
    return false;
  }
}

/** One tile's plants and trunks. Every random number comes from the tile's own generator, so a tile never depends on its neighbours. */
export function scatterTile(valley: Valley, tx: number, tz: number, seed: number): TileData {
  const rng = mulberry32(parseInt(hash([seed, tx, tz]), 16));
  const x0 = -WORLD_SIZE / 2 + tx * TILE_SIZE, z0 = -WORLD_SIZE / 2 + tz * TILE_SIZE;
  const bearing = new Points(), data = new Map<PlantKind, number[]>(), trunks: number[] = [];
  const site: SiteInfo = { b: undefined as never, slope: 0, moisture: 0, waterDepth: 0, wet: false, edge: 0, northness: 0 };

  for (const kind of ORDER) {
    const rule = SPECIES[kind].scatter, isTree = TREE_KINDS.includes(kind), cap = Math.round(rule.perHa * HA);
    const darts = Math.ceil(rule.perHa * HA * 1.5), own = new Points(), out: number[] = [];
    let kept = 0;
    for (let d = 0; d < darts && kept < cap; d++) {
      const lx = rng() * TILE_SIZE, lz = rng() * TILE_SIZE, roll = rng(), x = x0 + lx, z = z0 + lz;
      if (own.near(lx, lz, rule.spacing) || bearing.near(lx, lz, CLEARANCE)) continue;
      // Every rule's suitability is zero in water, so skip the rest of the survey there.
      if (valley.isWater(x, z)) continue;
      const n = valley.normalAt(x, z), b = valley.biomeAt(x, z);
      site.b = b; site.slope = Math.acos(Math.min(1, n.y)) * RAD2DEG; site.moisture = valley.moistureAt(x, z);
      site.waterDepth = valley.waterDepthAt(x, z); site.wet = false;
      site.edge = 4 * b.forest * (1 - b.forest); site.northness = -n.z;
      if (roll >= rule.suit(site)) continue;

      const yaw = rng() * Math.PI * 2, scale = 0.85 + 0.3 * rng();
      const h = Math.hypot(n.x, n.z) || 1, downhill = 0.15 * (1 - n.y) / h;
      const leanX = 0.04 * (2 * rng() - 1) + downhill * n.x, leanZ = 0.04 * (2 * rng() - 1) + downhill * n.z;
      const tint = 2 * rng() - 1, age = isTree ? 0.15 + 0.85 * Math.pow(rng(), 0.6) : 1;
      const variant = age < 0.45 ? Math.floor(rng() * 2) : 2 + Math.floor(rng() * 4);
      out.push(x, valley.heightAt(x, z) - 0.08, z, yaw, scale, leanX, leanZ, tint, age, 1, variant);
      own.add(lx, lz); if (BEARING.has(kind)) bearing.add(lx, lz);
      kept++;

      if (kind === 'log') {
        const reach = (LOG_LENGTH * scale) / 3, dx = Math.cos(yaw), dz = -Math.sin(yaw); // models lie along +x, turned by yaw about +y
        for (const o of [-reach, 0, reach]) trunks.push(x + dx * o, z + dz * o, LOG_RADIUS * scale);
      } else if (rule.trunk > 0) trunks.push(x, z, rule.trunk * scale * Math.max(age, 0.3));
    }
    data.set(kind, out);
  }

  // Store in `PLANT_KINDS` order; each kept plant was pushed as INSTANCE_STRIDE floats plus its variant.
  const rows = INSTANCE_STRIDE + 1, total = PLANT_KINDS.reduce((s, k) => s + data.get(k)!.length / rows, 0);
  const kindOut = new Uint8Array(total), variantOut = new Uint8Array(total), dataOut = new Float32Array(total * INSTANCE_STRIDE);
  let i = 0;
  PLANT_KINDS.forEach((kind, ki) => {
    const src = data.get(kind)!;
    for (let s = 0; s < src.length; s += rows, i++) {
      kindOut[i] = ki; variantOut[i] = src[s + INSTANCE_STRIDE];
      for (let f = 0; f < INSTANCE_STRIDE; f++) dataOut[i * INSTANCE_STRIDE + f] = src[s + f];
    }
  });
  return { tx, tz, plants: { kind: kindOut, variant: variantOut, data: dataOut }, trunks: new Float32Array(trunks) };
}

/** Every tile (`TILES` x `TILES`, row-major `tz * TILES + tx`). */
export function scatterAll(valley: Valley, seed: number): TileData[] {
  const out: TileData[] = [];
  for (let tz = 0; tz < TILES; tz++) for (let tx = 0; tx < TILES; tx++) out.push(scatterTile(valley, tx, tz, seed));
  return out;
}

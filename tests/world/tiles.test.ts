import { describe, expect, it } from 'vitest';
import { GPU_STRIDE, TILE_RADIUS, bandFor, collectInstances, thinned, tileDistance, type Band } from '../../src/world/tiles';
import { WORLD_QUALITY } from '../../src/world/quality';
import { INSTANCE_STRIDE, TILE_SIZE, type TileData } from '../../src/valley/types';
import { PLANT_KINDS, VARIANTS } from '../../src/plants/species';
import { mulberry32 } from '../../src/util/rng';

const q = WORLD_QUALITY.high;
const K = (k: (typeof PLANT_KINDS)[number]) => PLANT_KINDS.indexOf(k);

describe('bandFor', () => {
  it('puts trees near, mid and far by nearTree, midTree and viewDistance', () => {
    expect(bandFor('pine', 0, q)).toBe('near');
    expect(bandFor('pine', q.nearTree - 0.1, q)).toBe('near');
    expect(bandFor('pine', q.nearTree + 0.1, q)).toBe('mid');
    expect(bandFor('spruce', q.midTree - 0.1, q)).toBe('mid');
    expect(bandFor('birch', q.midTree + 0.1, q)).toBe('far');
    expect(bandFor('willow', q.viewDistance - 1, q)).toBe('far');
    expect(bandFor('alder', q.viewDistance + 1, q)).toBe('none');
  });

  it('puts shrubs near, mid and far by nearShrub, midShrub and shrubCull, and nothing beyond', () => {
    expect(bandFor('blueberry', q.nearShrub - 1, q)).toBe('near');
    expect(bandFor('fern', q.nearShrub + 1, q)).toBe('mid');
    expect(bandFor('juniper', q.midShrub + 1, q)).toBe('far');
    expect(bandFor('blueberry', q.shrubCull + 1, q)).toBe('none');
  });

  it('puts props near within 50 m and mid up to propCull', () => {
    expect(bandFor('boulder', 49, q)).toBe('near');
    expect(bandFor('log', 51, q)).toBe('mid');
    expect(bandFor('stump', q.propCull - 1, q)).toBe('mid');
    expect(bandFor('boulder', q.propCull + 1, q)).toBe('none');
  });

  it('keeps the previous, nearer band until 10% past its edge', () => {
    const edge = q.nearTree;
    expect(bandFor('pine', edge * 1.05, q, 'near')).toBe('near');
    expect(bandFor('pine', edge * 1.11, q, 'near')).toBe('mid');
    expect(bandFor('pine', edge * 1.05, q, 'mid')).toBe('mid'); // coming from further out: the plain threshold
    expect(bandFor('pine', edge * 0.99, q, 'mid')).toBe('near');
    expect(bandFor('blueberry', q.shrubCull * 1.08, q, 'far')).toBe('far');
    expect(bandFor('blueberry', q.shrubCull * 1.12, q, 'far')).toBe('none');
    expect(bandFor('pine', q.midTree * 1.05, q, 'near')).toBe('far'); // grace only at the edge of the band it was in
  });
});

describe('tileDistance', () => {
  it('measures from the tile centre less the tile radius, never below 0', () => {
    // tile (12, 12) is centred on the origin, tile (0, 0) on (−768, −768)
    expect(tileDistance({ x: 0, y: 0, z: 0 }, 12, 12)).toBe(0);
    expect(tileDistance({ x: 100, y: 0, z: 0 }, 12, 12)).toBeCloseTo(100 - TILE_RADIUS, 6);
    expect(tileDistance({ x: -768 + 30, y: 0, z: -768 }, 0, 0)).toBe(0);
  });

  it("counts height above the tile's ground", () => {
    expect(tileDistance({ x: 0, y: 140, z: 0 }, 12, 12, 0)).toBeGreaterThan(100);
    expect(tileDistance({ x: 100, y: 0, z: 0 }, 12, 12, 0)).toBeCloseTo(100 - TILE_RADIUS, 6);
  });
});

/** A tile with `n` plants of `kinds` (cycled), random tints, numbered positions. */
function fakeTile(tx: number, tz: number, n: number, kinds: number[], seed: number): TileData {
  const rng = mulberry32(seed), kind = new Uint8Array(n), variant = new Uint8Array(n), data = new Float32Array(n * INSTANCE_STRIDE);
  for (let i = 0; i < n; i++) {
    kind[i] = kinds[i % kinds.length];
    variant[i] = i % VARIANTS;
    data.set([-800 + tx * TILE_SIZE + rng() * 64, rng() * 10, -800 + tz * TILE_SIZE + rng() * 64, rng() * 6, 1, 0, 0, 2 * rng() - 1, 1, 1],
      i * INSTANCE_STRIDE);
  }
  return { tx, tz, plants: { kind, variant, data }, trunks: new Float32Array() };
}

describe('collectInstances', () => {
  const tiles = [fakeTile(3, 4, 300, [K('pine'), K('blueberry')], 1), fakeTile(4, 4, 200, [K('pine'), K('boulder')], 2),
    fakeTile(5, 4, 100, [K('pine')], 3)];
  const full = PLANT_KINDS.map(() => 1);
  const total = (b: ReturnType<typeof collectInstances>) => b.reduce((s, x) => s + x.count, 0);
  const xs = (b: ReturnType<typeof collectInstances>) => b.flatMap((x) => Array.from({ length: x.count }, (_, i) => x.data[i * GPU_STRIDE]));

  it('returns only the instances of the kinds asked for, from tiles in the requested band', () => {
    const bands: Band[] = ['near', 'mid', 'near'];
    const near = collectInstances(tiles, bands, 'near', { kinds: [K('pine')], density: full });
    expect(total(near)).toBe(150 + 100); // tile 0's pines and all of tile 2
    for (const x of xs(near)) expect(x < -800 + 4 * 64 || x >= -800 + 5 * 64).toBe(true); // nothing from tile 1
    // each lands in its own (kind, variant) bucket
    for (let m = 0; m < near.length; m++) if (near[m].count) expect(Math.floor(m / VARIANTS)).toBe(K('pine'));
    const mid = collectInstances(tiles, bands, 'mid', { kinds: [K('pine'), K('boulder')], density: full });
    expect(total(mid)).toBe(200);
    expect(collectInstances(tiles, ['none', 'none', 'none'], 'near', { kinds: [K('pine')], density: full }).every((b) => b.count === 0)).toBe(true);
  });

  it('copies the stored instance and adds a phase and the model height', () => {
    const heights = Array.from({ length: PLANT_KINDS.length * VARIANTS }, (_, i) => i + 0.5);
    const out = collectInstances([tiles[2]], ['near'], 'near', { kinds: [K('pine')], density: full, heights });
    const b = out[K('pine') * VARIANTS + 0], src = tiles[2].plants.data;
    expect(b.count).toBeGreaterThan(0);
    for (let f = 0; f < INSTANCE_STRIDE; f++) expect(b.data[f]).toBe(src[f]); // the first pine is the tile's first plant, variant 0
    expect(b.data[INSTANCE_STRIDE]).toBeGreaterThanOrEqual(0);
    expect(b.data[INSTANCE_STRIDE]).toBeLessThan(2 * Math.PI);
    expect(b.data[INSTANCE_STRIDE + 1]).toBe(K('pine') * VARIANTS + 0.5);
  });

  it('thins deterministically, in proportion to the density (±5% over 10k instances)', () => {
    const big = [fakeTile(0, 0, 10_000, [K('fern')], 9)];
    for (const d of [0.25, 0.5, 0.7]) {
      const density = PLANT_KINDS.map(() => d);
      const a = collectInstances(big, ['near'], 'near', { kinds: [K('fern')], density });
      const b = collectInstances(big, ['near'], 'near', { kinds: [K('fern')], density });
      expect(Math.abs(total(a) / 10_000 - d)).toBeLessThan(0.05 * d);
      expect(xs(a)).toEqual(xs(b));
      // the same rule as WorldQuality documents, instance by instance
      const kept = Array.from({ length: 10_000 }, (_, i) => i).filter((i) => !thinned(big[0].plants.data[i * INSTANCE_STRIDE + 7], i, d));
      expect(total(a)).toBe(kept.length);
    }
    // a thinner density keeps a subset of a denser one
    const at = (d: number) => new Set(xs(collectInstances(big, ['near'], 'near', { kinds: [K('fern')], density: PLANT_KINDS.map(() => d) })));
    const half = at(0.5), most = at(0.8);
    for (const x of half) expect(most.has(x)).toBe(true);
  });

  it("with a split, hands the far part of near tiles to the mid band, by each instance's distance", () => {
    const bands: Band[] = ['near', 'mid', 'none'], split = { x: -800 + 3 * 64, y: 5, z: -800 + 4 * 64 + 32, edge: 40 };
    const o = { kinds: [K('pine')], density: full, split };
    const near = collectInstances(tiles, bands, 'near', o), mid = collectInstances(tiles, bands, 'mid', o);
    const dist = (b: ReturnType<typeof collectInstances>) => b.flatMap((x) => Array.from({ length: x.count },
      (_, i) => Math.hypot(x.data[i * GPU_STRIDE] - split.x, x.data[i * GPU_STRIDE + 1] - split.y, x.data[i * GPU_STRIDE + 2] - split.z)));
    expect(total(near)).toBeGreaterThan(0);
    for (const d of dist(near)) expect(d).toBeLessThan(40);
    expect(total(near) + total(mid)).toBe(150 + 100); // tile 0's pines are split between the two; tile 1's all go mid
    const fromTile0 = dist(mid).filter((_, i) => xs(mid)[i] < -800 + 4 * 64);
    expect(fromTile0.length).toBeGreaterThan(0);
    for (const d of fromTile0) expect(d).toBeGreaterThanOrEqual(40);
  });

  it('with a split, drops mid plants beyond its far edge', () => {
    const split = { x: -800 + 3 * 64, y: 5, z: -800 + 4 * 64 + 32, edge: 20, far: 60 };
    const mid = collectInstances(tiles, ['near', 'mid', 'mid'], 'mid', { kinds: [K('pine')], density: full, split });
    const d = mid.flatMap((x) => Array.from({ length: x.count },
      (_, i) => Math.hypot(x.data[i * GPU_STRIDE] - split.x, x.data[i * GPU_STRIDE + 1] - split.y, x.data[i * GPU_STRIDE + 2] - split.z)));
    expect(d.length).toBeGreaterThan(10);
    for (const x of d) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(60); }
  });

  it('can fold variants together, rescaling each plant to keep its height', () => {
    const heights = Array.from({ length: PLANT_KINDS.length * VARIANTS }, (_, i) => 10 + (i % VARIANTS));
    const remap = [1, 1, 3, 3, 5, 5];
    const out = collectInstances([tiles[2]], ['mid'], 'mid', { kinds: [K('pine')], density: full, heights, remap });
    const base = K('pine') * VARIANTS;
    expect([0, 2, 4].map((v) => out[base + v].count)).toEqual([0, 0, 0]);
    expect(out[base + 1].count + out[base + 3].count + out[base + 5].count).toBe(100);
    // the tile's first plant (variant 0, scale 1) now uses variant 1's model, shrunk to variant 0's height
    expect(out[base + 1].data[4]).toBeCloseTo(10 / 11, 6);
    expect(out[base + 1].data[INSTANCE_STRIDE + 1]).toBe(11);
  });

  it('reuses and grows the buckets it is given', () => {
    const out = collectInstances([tiles[2]], ['near'], 'near', { kinds: [K('pine')], density: full });
    const again = collectInstances(tiles, ['near', 'near', 'near'], 'near', { kinds: [K('pine')], density: full }, out);
    expect(again).toBe(out);
    expect(total(again)).toBe(150 + 100 + 100);
    for (const b of again) expect(b.data.length).toBeGreaterThanOrEqual(b.count * GPU_STRIDE);
  });
});

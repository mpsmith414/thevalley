import { describe, expect, it } from 'vitest';
import {
  BAKE_ELEVATION, FADE, IMPOSTOR_ROWS, bayer4, farFade, impostorRow, impostorVisible, packImpostors, viewFrame, viewIndex,
} from '../../src/plants/impostor';
import { WORLD_QUALITY } from '../../src/world/quality';
import { GPU_STRIDE, thinned } from '../../src/world/tiles';
import { PLANT_KINDS, TREE_KINDS, VARIANTS } from '../../src/plants/species';
import { INSTANCE_STRIDE, TILE_SIZE, type TileData } from '../../src/valley/types';
import { mulberry32 } from '../../src/util/rng';

const q = WORLD_QUALITY.high;
const deg = (d: number) => (d * Math.PI) / 180;
const K = (k: (typeof PLANT_KINDS)[number]) => PLANT_KINDS.indexOf(k);

describe('viewIndex', () => {
  it('wraps around: 359° with yaw 0 blends view 7 into view 0', () => {
    const v = viewIndex(deg(359), 0);
    expect(v.a).toBe(7);
    expect(v.b).toBe(0);
    expect(v.t).toBeCloseTo(44 / 45, 6);
  });

  it('measures the angle from the instance yaw, either way round', () => {
    expect(viewIndex(deg(90) + 1.3, 1.3)).toEqual({ a: 2, b: 3, t: expect.closeTo(0, 6) });
    expect(viewIndex(deg(-1), 0)).toMatchObject({ a: 7, b: 0 });
    expect(viewIndex(0, deg(1))).toMatchObject({ a: 7, b: 0 });
    expect(viewIndex(deg(22.5), 0)).toEqual({ a: 0, b: 1, t: expect.closeTo(0.5, 6) });
    expect(viewIndex(deg(10) + 40 * Math.PI, deg(10))).toMatchObject({ a: 0, b: 1 });
  });

  it('keeps t in [0, 1) and the views in range, for any angles and view counts', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const views = [4, 8, 16][i % 3];
      const { a, b, t } = viewIndex((rng() - 0.5) * 100, (rng() - 0.5) * 100, views);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
      expect(Number.isInteger(a) && a >= 0 && a < views).toBe(true);
      expect(b).toBe((a + 1) % views);
    }
    // exact multiples of the view step land on a view with t = 0 (not on t = 1 of the one before)
    for (let v = 0; v < 8; v++) expect(viewIndex(v * (Math.PI / 4), 0)).toEqual({ a: v, b: (v + 1) % 8, t: 0 });
  });
});

describe('impostorVisible and farFade', () => {
  it('is false inside midTree − 10 and beyond viewDistance, true between', () => {
    expect(impostorVisible(0, q)).toBe(false);
    expect(impostorVisible(q.midTree - FADE - 0.01, q)).toBe(false);
    expect(impostorVisible(q.midTree - FADE + 0.01, q)).toBe(true);
    expect(impostorVisible(q.midTree, q)).toBe(true);
    expect(impostorVisible(q.viewDistance - 1, q)).toBe(true);
    expect(impostorVisible(q.viewDistance + 0.01, q)).toBe(false);
    for (const t of ['medium', 'low'] as const) {
      const w = WORLD_QUALITY[t];
      expect(impostorVisible(w.midTree - FADE - 1, w)).toBe(false);
      expect(impostorVisible(w.midTree + 1, w)).toBe(true);
      expect(impostorVisible(w.viewDistance + 1, w)).toBe(false);
    }
  });

  it("fades the impostor in over the 10 m before midTree (the mid tree's share is 1 − fade)", () => {
    expect(farFade(q.midTree - FADE - 5, q)).toBe(0);
    expect(farFade(q.midTree - FADE, q)).toBe(0);
    expect(farFade(q.midTree - FADE / 2, q)).toBeCloseTo(0.5, 6);
    expect(farFade(q.midTree, q)).toBe(1);
    expect(farFade(q.midTree + 100, q)).toBe(1);
  });
});

describe('bayer4', () => {
  it('gives each of a 4×4 block of pixels its own threshold in (0, 1), repeating every 4 pixels', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const b = bayer4(x, y);
      expect(b).toBeGreaterThan(0);
      expect(b).toBeLessThan(1);
      seen.add(Math.round(b * 16 - 0.5));
      expect(bayer4(x + 4, y + 8)).toBe(b);
      expect(bayer4(x + 0.5, y + 0.5)).toBe(b); // pixel centres, as the GPU passes them
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it('splits every pixel between the impostor and the mid tree, so the cross-fade has no hole and no double', () => {
    // the impostor keeps a pixel when bayer < fade, the mid tree when bayer >= fade
    for (const f of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
      let imp = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) imp += bayer4(x, y) < f ? 1 : 0;
      expect(Math.abs(imp / 16 - f)).toBeLessThanOrEqual(1 / 32 + 1e-9);
    }
  });
});

describe('viewFrame', () => {
  it('frames a vertical pole: as wide as it is, from its foot to its top seen from 8° up', () => {
    const pole = new Float32Array([0, 0, 0, 0, 10, 0, 0.5, 0, 0, -0.5, 10, 0]);
    const f = viewFrame(pole);
    expect(f.halfWidth).toBeGreaterThanOrEqual(0.5);
    expect(f.halfWidth).toBeLessThan(0.6);
    // the quad is in model metres: its top reaches the pole's top (scaled back from the tilted view)
    expect(f.top).toBeGreaterThanOrEqual(10);
    expect(f.top).toBeLessThan(10.6);
    expect(f.bottom).toBeLessThanOrEqual(-0.5 * Math.tan(BAKE_ELEVATION));
    expect(f.bottom).toBeGreaterThan(-0.3);
  });

  it('holds a crown off the axis in every view', () => {
    const p = new Float32Array([3, 5, 0, -2, 8, 1, 0, 0, 0]);
    const f = viewFrame(p);
    expect(f.halfWidth).toBeGreaterThanOrEqual(3);
    expect(f.top).toBeGreaterThanOrEqual(8);
    expect(f.bottom).toBeLessThan(0);
  });
});

/** A tile with `n` plants of `kinds` (cycled), every variant, random tints. */
function fakeTile(tx: number, tz: number, n: number, kinds: number[], seed: number): TileData {
  const rng = mulberry32(seed), kind = new Uint8Array(n), variant = new Uint8Array(n), data = new Float32Array(n * INSTANCE_STRIDE);
  for (let i = 0; i < n; i++) {
    kind[i] = kinds[i % kinds.length];
    variant[i] = i % VARIANTS;
    data.set([-800 + tx * TILE_SIZE + rng() * 64, rng() * 10, -800 + tz * TILE_SIZE + rng() * 64, rng() * 6, 1, 0.01, -0.02, 2 * rng() - 1, 0.7, 1],
      i * INSTANCE_STRIDE);
  }
  return { tx, tz, plants: { kind, variant, data }, trunks: new Float32Array() };
}

describe('impostorRow', () => {
  it('gives the 5 tree kinds × 3 baked variants their own rows, with young and mature variants folded as in the mid band', () => {
    const rows = new Set<number>();
    for (const k of TREE_KINDS) for (let v = 0; v < VARIANTS; v++) rows.add(impostorRow(K(k), v));
    expect(IMPOSTOR_ROWS).toBe(15);
    expect([...rows].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i));
    expect(impostorRow(K('pine'), 0)).toBe(impostorRow(K('pine'), 1));
    expect(impostorRow(K('spruce'), 4)).toBe(impostorRow(K('spruce'), 5));
    expect(impostorRow(K('spruce'), 3)).not.toBe(impostorRow(K('spruce'), 4));
  });
});

describe('packImpostors', () => {
  const tiles = [fakeTile(3, 4, 300, [K('pine'), K('blueberry'), K('birch')], 1), fakeTile(9, 9, 200, [K('willow'), K('boulder')], 2)];
  const heights = Array.from({ length: PLANT_KINDS.length * VARIANTS }, (_, i) => 5 + (i % VARIANTS));

  it('holds every tree of the valley, thinned by density, and nothing else', () => {
    const full = packImpostors(tiles, PLANT_KINDS.map(() => 1), heights);
    expect(full.count).toBe(200 + 100);
    const half = packImpostors(tiles, PLANT_KINDS.map(() => 0.5), heights);
    let kept = 0;
    for (const t of tiles) {
      const { kind, data } = t.plants;
      for (let i = 0; i < kind.length; i++) {
        if (TREE_KINDS.includes(PLANT_KINDS[kind[i]]) && !thinned(data[i * INSTANCE_STRIDE + 7], i, 0.5)) kept++;
      }
    }
    expect(half.count).toBe(kept);
  });

  it('keeps each tree where it stands, at its own height, and records its atlas row', () => {
    const { data, count } = packImpostors([tiles[0]], PLANT_KINDS.map(() => 1), heights);
    const src = tiles[0].plants;
    // the trees of tile 0, in order: plant i is a pine (i % 3 == 0) or a birch (i % 3 == 2)
    const trees = Array.from({ length: 300 }, (_, i) => i).filter((i) => i % 3 !== 1);
    expect(count).toBe(trees.length);
    trees.forEach((i, n) => {
      const s = i * INSTANCE_STRIDE, at = n * GPU_STRIDE, k = src.kind[i], v = src.variant[i];
      for (const f of [0, 1, 2, 3, 5, 6, 7]) expect(data[at + f]).toBe(src.data[s + f]); // x, y, z, yaw, lean, tint
      const baked = [1, 1, 3, 3, 5, 5][v];
      const height = data[at + 4] * heights[k * VARIANTS + baked];
      expect(height).toBeCloseTo(src.data[s + 4] * heights[k * VARIANTS + v], 4); // rescaled to keep its own height
      expect(data[at + 11]).toBe(impostorRow(k, v));
    });
  });
});

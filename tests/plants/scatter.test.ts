import { describe, it, expect } from 'vitest';
import { scatterTile, scatterAll } from '../../src/plants/scatter';
import { PLANT_KINDS, SPECIES, TREE_KINDS, VARIANTS, type PlantKind } from '../../src/plants/species';
import { createValley } from '../../src/valley/valley';
import { INSTANCE_STRIDE, TILE_SIZE, TILES, WORLD_SIZE, type TileData } from '../../src/valley/types';
import { hashNumbers } from '../../src/util/hash';
import { smallValleyData } from '../fixtures/valley';

const SEED = 20261007, S = INSTANCE_STRIDE;
const valley = createValley(smallValleyData(513));
const tileOf = (x: number, z: number): [number, number] => [Math.floor((x + WORLD_SIZE / 2) / TILE_SIZE), Math.floor((z + WORLD_SIZE / 2) / TILE_SIZE)];
const tileHash = (t: TileData) => [hashNumbers(t.plants.kind), hashNumbers(t.plants.variant), hashNumbers(t.plants.data), hashNumbers(t.trunks)].join('-');
const kindName = (t: TileData, i: number) => PLANT_KINDS[t.plants.kind[i]];
const count = (t: TileData) => t.plants.kind.length;
const isTree = (k: PlantKind) => TREE_KINDS.includes(k);
const treeCount = (t: TileData) => t.plants.kind.reduce((n, k) => n + (isTree(PLANT_KINDS[k]) ? 1 : 0), 0);
let all: TileData[] | undefined;
const tiles = () => (all ??= scatterAll(valley, SEED));
const forestTile = tileOf(-450, 520), meadowTile = tileOf(-260, 200);
/** Plants that stand in the way (trunk-bearing for the cross-kind spacing rule). */
const BEARING = new Set(['pine', 'spruce', 'birch', 'alder', 'willow', 'boulder', 'log', 'stump'].map((k) => PLANT_KINDS.indexOf(k as PlantKind)));

describe('scatterTile', () => {
  it('is deterministic for a seed and changes with it', () => {
    const [tx, tz] = forestTile;
    expect(tileHash(scatterTile(valley, tx, tz, SEED))).toBe(tileHash(scatterTile(valley, tx, tz, SEED)));
    expect(tileHash(scatterTile(valley, tx, tz, SEED))).not.toBe(tileHash(scatterTile(valley, tx, tz, SEED + 1)));
  });

  it('lays out typed arrays that match in length, in kind order', () => {
    const t = scatterTile(valley, forestTile[0], forestTile[1], SEED);
    expect([t.tx, t.tz]).toEqual(forestTile);
    expect(count(t)).toBeGreaterThan(0);
    expect(t.plants.variant.length).toBe(count(t));
    expect(t.plants.data.length).toBe(count(t) * S);
    expect(t.trunks.length % 3).toBe(0);
    expect(Array.from(t.plants.kind).every((k, i, a) => i === 0 || k >= a[i - 1])).toBe(true);
    for (const v of t.plants.variant) expect(v).toBeLessThan(VARIANTS);
    for (const v of t.plants.data) expect(Number.isFinite(v)).toBe(true);
  });

  it('keeps instances inside their tile', () => {
    for (const [tx, tz] of [forestTile, meadowTile, tileOf(-100, 0), tileOf(0, 300)]) {
      const t = scatterTile(valley, tx, tz, SEED), x0 = -WORLD_SIZE / 2 + tx * TILE_SIZE, z0 = -WORLD_SIZE / 2 + tz * TILE_SIZE;
      for (let i = 0; i < count(t); i++) {
        const x = t.plants.data[i * S], z = t.plants.data[i * S + 2];
        expect(x).toBeGreaterThanOrEqual(x0);
        expect(x).toBeLessThan(x0 + TILE_SIZE);
        expect(z).toBeGreaterThanOrEqual(z0);
        expect(z).toBeLessThan(z0 + TILE_SIZE);
      }
    }
  });

  it('gives each instance a sane scale, tint, age, health and a variant to match its age', () => {
    const t = scatterTile(valley, forestTile[0], forestTile[1], SEED);
    for (let i = 0; i < count(t); i++) {
      const d = t.plants.data, o = i * S, k = kindName(t, i);
      expect(d[o + 4]).toBeGreaterThanOrEqual(0.85);
      expect(d[o + 4]).toBeLessThanOrEqual(1.15);
      expect(Math.abs(d[o + 7])).toBeLessThanOrEqual(1);
      expect(d[o + 9]).toBe(1);
      if (isTree(k)) expect(d[o + 8]).toBeGreaterThanOrEqual(0.15);
      else expect(d[o + 8]).toBe(1);
      if (d[o + 8] < 0.45) expect(t.plants.variant[i]).toBeLessThan(2);
      else expect(t.plants.variant[i]).toBeGreaterThanOrEqual(2);
    }
  });

  it('sinks every plant 0.08 m into the ground', () => {
    const t = scatterTile(valley, forestTile[0], forestTile[1], SEED);
    for (let i = 0; i < count(t); i++) {
      expect(t.plants.data[i * S + 1]).toBeCloseTo(valley.heightAt(t.plants.data[i * S], t.plants.data[i * S + 2]) - 0.08, 4);
    }
  });

  it("stays under each kind's per-tile count cap", () => {
    for (const [tx, tz] of [forestTile, meadowTile]) {
      const t = scatterTile(valley, tx, tz, SEED);
      for (const k of PLANT_KINDS) {
        let n = 0;
        for (let i = 0; i < count(t); i++) if (kindName(t, i) === k) n++;
        expect(n).toBeLessThanOrEqual(Math.round(SPECIES[k].scatter.perHa * 0.4096));
      }
    }
  });

  it('writes one trunk circle per tree, boulder and stump and three per log', () => {
    const t = scatterTile(valley, forestTile[0], forestTile[1], SEED);
    let want = 0;
    for (let i = 0; i < count(t); i++) {
      const k = kindName(t, i);
      if (k === 'log') want += 3;
      else if (SPECIES[k].scatter.trunk > 0) want++;
    }
    expect(want).toBeGreaterThan(0);
    expect(t.trunks.length / 3).toBe(want);
    for (let i = 0; i < t.trunks.length; i += 3) expect(t.trunks[i + 2]).toBeGreaterThan(0);
  });
});

describe('scatterAll', () => {
  it('returns every tile in row-major order', () => {
    const a = tiles();
    expect(a.length).toBe(TILES * TILES);
    a.forEach((t, i) => expect([t.tx, t.tz]).toEqual([i % TILES, Math.floor(i / TILES)]));
  });

  it('plants nothing in water or on slopes over 45 degrees (boulders 55)', () => {
    let n = 0;
    for (const t of tiles()) for (let i = 0; i < count(t); i++) {
      if (n++ % 3) continue; // a third of them is plenty
      const x = t.plants.data[i * S], z = t.plants.data[i * S + 2];
      expect(valley.isWater(x, z)).toBe(false);
      const slope = (Math.acos(valley.normalAt(x, z).y) * 180) / Math.PI;
      expect(slope).toBeLessThan(kindName(t, i) === 'boulder' ? 55 : 45);
    }
  });

  it('keeps trees out of water of any depth', () => {
    for (const t of tiles()) for (let i = 0; i < count(t); i++) {
      if (isTree(kindName(t, i))) expect(valley.waterDepthAt(t.plants.data[i * S], t.plants.data[i * S + 2])).toBe(0);
    }
  });

  it('respects the same-kind spacing within a tile', () => {
    for (const k of PLANT_KINDS) {
      let worst = Infinity; // smallest gap beyond the kind's spacing
      for (const t of tiles().filter((_, i) => i % 7 === 0)) {
        const d = t.plants.data, n = count(t);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n && t.plants.kind[j] === t.plants.kind[i]; j++) { // kinds are stored together
          if (kindName(t, i) === k) worst = Math.min(worst, Math.hypot(d[i * S] - d[j * S], d[i * S + 2] - d[j * S + 2]) - SPECIES[k].scatter.spacing);
        }
      }
      expect(worst, k).toBeGreaterThanOrEqual(-1e-4);
    }
  });

  it('keeps other kinds 1.2 m away from trees, boulders, logs and stumps', () => {
    let worst = Infinity;
    for (const t of tiles().filter((_, i) => i % 11 === 0)) {
      const d = t.plants.data, n = count(t);
      for (let i = 0; i < n; i++) {
        if (!BEARING.has(t.plants.kind[i])) continue;
        for (let j = 0; j < n; j++) {
          if (t.plants.kind[i] !== t.plants.kind[j]) worst = Math.min(worst, Math.hypot(d[i * S] - d[j * S], d[i * S + 2] - d[j * S + 2]));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(1.2 - 1e-4);
  });

  it('grows fewer trees in the meadow than in the forest', () => {
    const at = (p: number[]) => treeCount(tiles()[p[1] * TILES + p[0]]);
    expect(at(meadowTile)).toBeLessThan(at(forestTile));
  });

  it('keeps alder and willow within 60 m of water', () => {
    const near = (x: number, z: number) => {
      for (let r = 0; r <= 60; r += 4) for (let a = 0; a < 16; a++) if (valley.isWater(x + r * Math.cos((a * Math.PI) / 8), z + r * Math.sin((a * Math.PI) / 8))) return true;
      return false;
    };
    let checked = 0;
    for (const t of tiles()) for (let i = 0; i < count(t); i++) {
      const k = kindName(t, i);
      if (k !== 'alder' && k !== 'willow') continue;
      checked++;
      expect(near(t.plants.data[i * S], t.plants.data[i * S + 2])).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('grows between 30k and 90k trees over the valley, whatever the grid', () => {
    const n = tiles().reduce((s, t) => s + treeCount(t), 0);
    expect(n).toBeGreaterThan(30_000);
    expect(n).toBeLessThan(90_000);
  });
});

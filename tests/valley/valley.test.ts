import { describe, it, expect } from 'vitest';
import { smallValleyData } from '../fixtures/valley';
import { createValley } from '../../src/valley/valley';
import { VALLEY } from '../../src/valley/layout';
import type { TileData } from '../../src/valley/types';

const d = smallValleyData(513);
const v = createValley(d);
const cell = d.size / (d.grid - 1);

describe('createValley', () => {
  it('heightAt equals the grid at sample points and interpolates between them', () => {
    for (const [ix, iz] of [[0, 0], [100, 200], [256, 256], [512, 512], [33, 480]]) {
      expect(v.heightAt(-800 + ix * cell, -800 + iz * cell)).toBeCloseTo(d.height[iz * d.grid + ix], 4);
    }
    const a = d.height[300 * d.grid + 300], b = d.height[300 * d.grid + 301];
    expect(v.heightAt(-800 + 300.5 * cell, -800 + 300 * cell)).toBeCloseTo((a + b) / 2, 4);
  });

  it('knows where the water is', () => {
    const o = VALLEY.lake.outline, lake = o.reduce((c, p) => ({ x: c.x + p.x / o.length, z: c.z + p.z / o.length }), { x: 0, z: 0 });
    expect(v.isWater(lake.x, lake.z)).toBe(true);
    expect(v.isWater(-180, -90)).toBe(true); // on the river
    expect(v.isWater(-250, 200)).toBe(false); // the meadow
    expect(v.isWater(-800, -800)).toBe(false);
  });

  it('reports water level and depth, NaN and 0 on dry land', () => {
    expect(v.waterLevelAt(150, 200)).toBe(0);
    expect(v.waterDepthAt(150, 200)).toBeGreaterThan(5);
    expect(Number.isNaN(v.waterLevelAt(-250, 200))).toBe(true);
    expect(v.waterDepthAt(-250, 200)).toBe(0);
    expect(v.waterLevelAt(-180, -90)).toBeGreaterThan(0);
  });

  it('flows along the river and nowhere else', () => {
    let n = 0;
    for (let k = 40; k < d.river.length - 40; k += 10) {
      const r = d.river[k], f = v.flowAt(r.x, r.z);
      if (!v.isWater(r.x, r.z)) continue;
      n++;
      const sp = Math.hypot(f.x, f.z);
      expect(sp).toBeGreaterThan(0.3);
      expect((f.x * r.tx + f.z * r.tz) / sp).toBeGreaterThan(0.8);
    }
    expect(n).toBeGreaterThan(10);
    expect(v.flowAt(-250, 200)).toEqual({ x: 0, z: 0 });
    expect(v.flowAt(150, 200)).toEqual({ x: 0, z: 0 }); // the lake is still
  });

  it('gives a unit normal that is nearly up on the floor and tilted on a slope', () => {
    const n = v.normalAt(-250, 200);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
    expect(n.y).toBeGreaterThan(0.95);
    expect(v.normalAt(520, -100).y).toBeLessThan(0.95); // on the granite ridge's west face (its crest, near x = 620, is rounded)
  });

  it('interpolates biomes and moisture from the map', () => {
    const m = v.biomeAt(-250, 200);
    expect(m.meadow).toBeGreaterThan(0.6);
    expect(m.forest + m.meadow + m.rock + m.shore + m.beach).toBeCloseTo(1, 1);
    expect(v.biomeAt(-450, 520).forest).toBeGreaterThan(0.6);
    expect(v.biomeAt(260, 330).beach).toBeGreaterThan(0.5);
    expect(v.moistureAt(-180, -90)).toBeGreaterThan(0.95);
    expect(v.moistureAt(-180, -90)).toBeGreaterThan(v.moistureAt(-250, 200));
    expect(v.moistureAt(-760, 760)).toBeLessThan(0.05);
  });

  it('finds the nearest point on the river', () => {
    const on = v.distanceToRiver(-180, -90);
    expect(on.d).toBeLessThan(2);
    expect(on.sample.surface).toBeGreaterThan(0);
    const r = d.river[100], off = v.distanceToRiver(r.x - r.tz * 30, r.z + r.tx * 30);
    expect(off.d).toBeGreaterThan(25);
    expect(off.d).toBeLessThan(31);
  });

  it('checks the playable area, with an optional margin', () => {
    expect(v.inside(0, 0)).toBe(true);
    expect(v.inside(800, -800)).toBe(true);
    expect(v.inside(800.1, 0)).toBe(false);
    expect(v.inside(790, 0, 20)).toBe(false);
    expect(v.inside(770, 770, 20)).toBe(true);
  });

  it('finds tree trunks near a point from the tiles, across tile borders', () => {
    expect(v.trunksNear(0, 0, 50)).toEqual([]);
    const empty = { kind: new Uint8Array(0), variant: new Uint8Array(0), data: new Float32Array(0) };
    // Tile (12, 12) covers x, z in [-32, 32); (13, 12) covers x in [32, 96).
    const tiles: TileData[] = [
      { tx: 12, tz: 12, plants: empty, trunks: new Float32Array([30, 0, 0.5, -20, 10, 0.4]) },
      { tx: 13, tz: 12, plants: empty, trunks: new Float32Array([34, 1, 0.6, 90, 0, 0.5]) },
    ];
    const t = createValley({ ...d, tiles });
    const near = t.trunksNear(32, 0, 5);
    expect(near.map((q) => q.x).sort((a, b) => a - b)).toEqual([30, 34]);
    expect(near.find((q) => q.x === 34)).toEqual({ x: 34, z: 1, r: Math.fround(0.6) });
    expect(t.trunksNear(32, 0, 1)).toEqual([]);
    expect(t.trunksNear(-800, -800, 10)).toEqual([]);
    expect(t.trunksNear(1000, 1000, 10)).toEqual([]);
  });
});

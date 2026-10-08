import { describe, expect, it } from 'vitest';
import { valleyHabitat } from '../../src/residents/habitat';
import { VALLEY } from '../../src/valley/layout';
import { TILE_SIZE, TILES, type HomeRange } from '../../src/valley/types';
import { createValley } from '../../src/valley/valley';
import { mulberry32 } from '../../src/util/rng';
import { smallValleyData } from '../fixtures/valley';

const data = smallValleyData(513);
const valley = createValley(data);
const home = (species: string) => VALLEY.homes.filter((h) => h.species === species);
const wetNear = (x: number, z: number, d: number) =>
  Array.from({ length: 8 }, (_, k) => valley.isWater(x + Math.cos((k * Math.PI) / 4) * d, z + Math.sin((k * Math.PI) / 4) * d)).some(Boolean);

describe('valleyHabitat', () => {
  it('puts land animals on dry ground inside their range', () => {
    for (const h of VALLEY.homes.filter((h) => h.medium === 'land' || h.medium === 'air')) {
      const hab = valleyHabitat(valley, h, mulberry32(11));
      for (let i = 0; i < 200; i++) {
        const p = hab.randomSpot('land', 1);
        expect(valley.isWater(p.x, p.z), `${h.species} ${i}`).toBe(false);
        expect(Math.hypot(p.x - h.center.x, p.z - h.center.z), h.species).toBeLessThanOrEqual(h.radius + 1e-6);
        expect(valley.inside(p.x, p.z, 20)).toBe(true);
      }
    }
  });

  it('keeps land animals off steep slopes', () => {
    const hab = valleyHabitat(valley, home('wolf')[0], mulberry32(12));
    for (let i = 0; i < 200; i++) {
      const p = hab.randomSpot('land', 1);
      expect((Math.acos(valley.normalAt(p.x, p.z).y) * 180) / Math.PI).toBeLessThan(30);
    }
  });

  it('keeps land animals off tree trunks', () => {
    const h = home('deer')[0];
    // a lattice of trunks, 3 m apart, across the tile holding the home centre
    const tx = Math.floor((h.center.x + 800) / TILE_SIZE), tz = Math.floor((h.center.z + 800) / TILE_SIZE);
    const trunks: number[] = [];
    for (let x = -800 + tx * TILE_SIZE; x < -800 + (tx + 1) * TILE_SIZE; x += 3) {
      for (let z = -800 + tz * TILE_SIZE; z < -800 + (tz + 1) * TILE_SIZE; z += 3) trunks.push(x, z, 0.3);
    }
    const empty = { kind: new Uint8Array(0), variant: new Uint8Array(0), data: new Float32Array(0) };
    const withTrees = createValley({ ...data, tiles: [{ tx, tz, plants: empty, trunks: new Float32Array(trunks) }] });
    expect(TILES).toBeGreaterThan(tx);
    const hab = valleyHabitat(withTrees, h, mulberry32(13));
    for (let i = 0; i < 200; i++) {
      const p = hab.randomSpot('land', 1);
      expect(withTrees.trunksNear(p.x, p.z, 0.8)).toHaveLength(0);
    }
  });

  it('puts fish in deep water', () => {
    for (const h of home('trout')) {
      const hab = valleyHabitat(valley, h, mulberry32(14));
      for (let i = 0; i < 200; i++) {
        const p = hab.randomSpot('water', 0.9);
        expect(valley.waterDepthAt(p.x, p.z)).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it('puts shore animals on dry ground with water close by', () => {
    const h = home('frog')[0];
    const hab = valleyHabitat(valley, h, mulberry32(15));
    for (let i = 0; i < 200; i++) {
      const p = hab.randomSpot('shore', 1);
      expect(valley.isWater(p.x, p.z)).toBe(false);
      expect(wetNear(p.x, p.z, 6)).toBe(true);
    }
  });

  it('falls back to a valid spot near the centre when sampling finds none', () => {
    const lake = home('trout')[0];
    const tiny: HomeRange = { species: 'x', count: 1, center: lake.center, radius: 0.01, medium: 'land', prefer: [] };
    expect(valley.isWater(tiny.center.x, tiny.center.z)).toBe(true);
    const p = valleyHabitat(valley, tiny, mulberry32(16)).randomSpot('land', 1);
    expect(valley.isWater(p.x, p.z)).toBe(false);
    expect(Math.hypot(p.x - tiny.center.x, p.z - tiny.center.z)).toBeLessThan(200);
  });

  it('finds a dry bank next to the nearest water', () => {
    const hab = valleyHabitat(valley, home('deer')[0], mulberry32(17));
    const from = { x: -250, z: 200 };
    expect(valley.isWater(from.x, from.z)).toBe(false);
    const bank = hab.nearestBank(from)!;
    expect(bank).not.toBeNull();
    expect(valley.isWater(bank.x, bank.z)).toBe(false);
    let wet = false;
    for (let dx = -2; dx <= 2; dx += 0.25) for (let dz = -2; dz <= 2; dz += 0.25) wet ||= Math.hypot(dx, dz) <= 2 && valley.isWater(bank.x + dx, bank.z + dz);
    expect(wet).toBe(true);
  });

  it('pulls points back into the range and the valley', () => {
    const h = home('rabbit')[0];
    const hab = valleyHabitat(valley, h, mulberry32(18));
    const c = hab.clamp({ x: h.center.x + 500, y: 0, z: h.center.z });
    expect(Math.hypot(c.x - h.center.x, c.z - h.center.z)).toBeCloseTo(h.radius, 5);
    const inRange = { x: h.center.x + 5, y: 0, z: h.center.z };
    expect(hab.clamp(inRange)).toEqual(inRange);
    const edge: HomeRange = { species: 'x', count: 1, center: { x: 790, z: 0 }, radius: 100, medium: 'land', prefer: [] };
    expect(valley.inside(valleyHabitat(valley, edge, mulberry32(19)).clamp({ x: 850, y: 0, z: 0 }).x, 0, 20)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const hab = valleyHabitat(valley, home('deer')[0], mulberry32(seed));
      return Array.from({ length: 20 }, () => hab.randomSpot('land', 0.8));
    };
    expect(run(21)).toEqual(run(21));
    expect(run(21)).not.toEqual(run(22));
  });
});

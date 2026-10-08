import { describe, it, expect } from 'vitest';
import { smallValleyData } from '../fixtures/valley';
import { computeNormals } from '../../src/valley/generate/biomes';

const GRID = 513;
const d = smallValleyData(GRID);
const M = d.water.mapGrid, mapCell = d.size / (M - 1), half = d.size / 2;
const FOREST = 0, MEADOW = 1, ROCK = 2, SHORE = 3, BEACH = 4, MOIST = 5;

/** One weight (0-1) at the map node nearest to (x, z). */
function at(x: number, z: number, ch: number): number {
  const ix = Math.round((x + half) / mapCell), iz = Math.round((z + half) / mapCell);
  return d.biomes[(iz * M + ix) * 6 + ch] / 255;
}
/** Slope in degrees at map node (ix, iz), from the height grid (central differences, one sample each side). */
function slopeDeg(ix: number, iz: number): number {
  const c = d.size / (GRID - 1), gx = 2 * ix, gz = 2 * iz;
  const x0 = Math.max(0, gx - 1), x1 = Math.min(GRID - 1, gx + 1), z0 = Math.max(0, gz - 1), z1 = Math.min(GRID - 1, gz + 1);
  const dx = (d.height[gz * GRID + x1] - d.height[gz * GRID + x0]) / ((x1 - x0) * c);
  const dz = (d.height[z1 * GRID + gx] - d.height[z0 * GRID + gx]) / ((z1 - z0) * c);
  return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
}

describe('computeBiomes', () => {
  it('has 6 bytes per map cell and the five weights sum to 255 (+-3)', () => {
    expect(d.biomes.length).toBe(M * M * 6);
    for (let c = 0; c < M * M; c++) {
      const s = d.biomes[c * 6] + d.biomes[c * 6 + 1] + d.biomes[c * 6 + 2] + d.biomes[c * 6 + 3] + d.biomes[c * 6 + 4];
      expect(Math.abs(s - 255)).toBeLessThanOrEqual(3);
    }
  });

  it('makes cells steeper than 45 degrees mostly rock', () => {
    let n = 0;
    for (let iz = 0; iz < M; iz++) for (let ix = 0; ix < M; ix++) {
      if (d.water.kind[iz * M + ix] !== 0 || slopeDeg(ix, iz) <= 45) continue; // water cells are shore by definition
      n++;
      expect(d.biomes[(iz * M + ix) * 6 + ROCK] / 255).toBeGreaterThan(0.8);
    }
    expect(n).toBeGreaterThan(50); // the check must bite: there are steep cells
  });

  it('puts beach on the beach, meadow in the meadow and forest in the forest', () => {
    expect(at(260, 330, BEACH)).toBeGreaterThan(0.5);
    expect(at(260, 345, BEACH)).toBeGreaterThan(0.3); // the Beach viewpoint
    expect(at(-250, 200, MEADOW)).toBeGreaterThan(0.6);
    expect(at(-450, 520, FOREST)).toBeGreaterThan(0.6);
  });

  it('turns water cells into shore', () => {
    let n = 0;
    for (let c = 0; c < M * M; c++) {
      if (d.water.kind[c] === 0) continue;
      n++;
      expect(d.biomes[c * 6 + SHORE]).toBe(255);
    }
    expect(n).toBeGreaterThan(100);
  });

  it('dries out with distance from the river', () => {
    const r = d.river[Math.floor(d.river.length * 0.3)]; // a mid-course sample, far from the lake
    for (const side of [1, -1]) {
      const m = (dist: number) => at(r.x - r.tz * side * dist, r.z + r.tx * side * dist, MOIST);
      expect(m(12)).toBeGreaterThan(m(50));
      expect(m(50)).toBeGreaterThan(m(150));
      expect(m(150)).toBeLessThan(0.1);
    }
    expect(at(r.x, r.z, MOIST)).toBeGreaterThan(0.95);
  });
});

describe('computeNormals', () => {
  it('stores unit normals mapped to bytes plus a cavity channel, RGBA per height sample', () => {
    expect(d.normals.length).toBe(GRID * GRID * 4);
    const g = { grid: GRID, size: d.size, cell: d.size / (GRID - 1), h: Float32Array.from({ length: GRID * GRID }, () => 3) };
    const flat = computeNormals(g);
    const k = (200 * GRID + 100) * 4;
    expect([flat[k], flat[k + 1], flat[k + 2]]).toEqual([128, 255, 128]);
    expect(flat[k + 3]).toBe(128); // flat: neither a bump nor a hollow
  });

  it('tilts with the slope and marks hollows brighter than bumps', () => {
    const grid = 9, cell = 1;
    const h = new Float32Array(grid * grid);
    for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) h[z * grid + x] = x; // rises to the east at 45 degrees
    h[4 * grid + 4] += 2; // a bump
    h[6 * grid + 2] -= 2; // a hollow
    const n = computeNormals({ grid, size: 8, cell, h });
    const px = (x: number, z: number) => (z * grid + x) * 4;
    const k = px(1, 1); // plain slope: normal (-0.707, 0.707, 0)
    expect(n[k]).toBe(Math.round((0.5 - 0.5 * Math.SQRT1_2) * 255));
    expect(n[k + 1]).toBe(Math.round((0.5 + 0.5 * Math.SQRT1_2) * 255));
    expect(n[k + 2]).toBe(128);
    expect(n[px(4, 4) + 3]).toBeLessThan(128);
    expect(n[px(2, 6) + 3]).toBeGreaterThan(128);
  });
});

import { describe, expect, it } from 'vitest';
import { LEVELS, N, levelCentres, morphFactor, ringCells, snapOrigin } from '../../src/world/terrain';
import { mulberry32 } from '../../src/util/rng';

const CELL = 1600 / 2048;

describe('clipmap helpers', () => {
  it('snapOrigin lands on a multiple of 2·spacing within 2·spacing of the camera', () => {
    const rng = mulberry32(7);
    for (let k = 0; k < LEVELS; k++) {
      const s = CELL * 2 ** k;
      for (let i = 0; i < 200; i++) {
        const cam = (rng() - 0.5) * 2000;
        const o = snapOrigin(cam, s);
        expect(Math.abs(o / (2 * s) - Math.round(o / (2 * s)))).toBeLessThan(1e-9);
        expect(Math.abs(o - cam)).toBeLessThanOrEqual(2 * s);
      }
    }
    expect(snapOrigin(0, 1)).toBe(0);
    expect(snapOrigin(2.9, 1)).toBe(2);
    expect(snapOrigin(3.1, 1)).toBe(4);
  });

  it('ringCells(0) is the full square', () => {
    const cells = ringCells(0);
    expect(cells.length).toBe(N * N);
    expect(new Set(cells).size).toBe(N * N);
  });

  it('ringCells(k > 0) is a square ring whose hole is the finer level', () => {
    for (let k = 1; k < LEVELS; k++) {
      const cells = ringCells(k), set = new Set(cells);
      expect(cells.length).toBe(N * N - (N / 2) ** 2);
      expect(set.size).toBe(cells.length);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const inHole = i >= N / 4 && i < (3 * N) / 4 && j >= N / 4 && j < (3 * N) / 4;
        expect(set.has(j * N + i)).toBe(!inHole);
      }
    }
  });

  it('morphFactor is 0 at the centre and 1 at the outer edge', () => {
    const half = 64;
    expect(morphFactor(0, half)).toBe(0);
    expect(morphFactor(half * 0.5, half)).toBe(0);
    expect(morphFactor(half * 0.8, half)).toBe(0);
    expect(morphFactor(half * 0.9, half)).toBeCloseTo(0.5);
    expect(morphFactor(half, half)).toBe(1);
    expect(morphFactor(half * 1.2, half)).toBe(1);
  });

  it('each ring hole, shifted by its offset, matches the finer square exactly', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const cx = (rng() - 0.5) * 1700, cz = (rng() - 0.5) * 1700;
      const levels = levelCentres(cx, cz, CELL);
      expect(levels).toHaveLength(LEVELS);
      for (let k = 1; k < LEVELS; k++) {
        const fine = levels[k - 1], coarse = levels[k], s = CELL * 2 ** k;
        for (const a of ['x', 'z'] as const) {
          const o = coarse.shift[a];
          expect([-1, 0, 1]).toContain(o);
          // hole edges at ±N/4 coarse cells, shifted by o; the finer square is ±N/2 fine cells
          expect(coarse.centre[a] + (-N / 4 + o) * s).toBeCloseTo(fine.centre[a] - (N / 2) * (s / 2), 6);
          expect(coarse.centre[a] + (N / 4 + o) * s).toBeCloseTo(fine.centre[a] + (N / 2) * (s / 2), 6);
        }
      }
      expect(levels[0].shift).toEqual({ x: 0, z: 0 });
    }
  });
});

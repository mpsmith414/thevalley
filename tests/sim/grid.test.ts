import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../../src/sim/grid';
import { Rng } from '../../src/sim/rng';

describe('SpatialGrid', () => {
  it('returns exactly the ids within r of a point', () => {
    const rng = new Rng(11);
    const pts = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, x: rng.range(-800, 800), z: rng.range(-800, 800) }));
    const grid = new SpatialGrid();
    pts.forEach((p) => grid.insert(p.id, p.x, p.z));
    for (let q = 0; q < 40; q++) {
      const x = rng.range(-800, 800), z = rng.range(-800, 800), r = rng.range(1, 200);
      const want = pts.filter((p) => Math.hypot(p.x - x, p.z - z) <= r).map((p) => p.id).sort();
      expect(grid.near(x, z, r).sort()).toEqual(want);
    }
  });
  it('empties on clear and reuses the output array', () => {
    const grid = new SpatialGrid(16);
    grid.insert('a', 1, 1);
    const out = ['stale'];
    expect(grid.near(0, 0, 5, out)).toBe(out);
    expect(out).toEqual(['a']);
    grid.clear();
    expect(grid.near(0, 0, 5, out)).toEqual([]);
    grid.insert('b', -3, -3);
    expect(grid.near(0, 0, 5)).toEqual(['b']);
  });
});

import { describe, it, expect } from 'vitest';
import { ringLayout, snapToCell, ringCounts } from '../../src/plants/grass';

const ringOf = (out: Float32Array, i: number, radii: number[]) => {
  const d = Math.hypot(out[2 * i], out[2 * i + 1]) + 1e-4; // float32: a point on a ring's inner edge may read a hair short of it
  return radii.findIndex((r) => d < r);
};

describe('ringLayout', () => {
  it('lays each ring out at its own spacing, with a count within 2% of area / spacing²', () => {
    for (const [spacings, radii] of [[[0.35, 0.7, 1.4], [15, 35, 60]], [[0.9, 1.8], [25, 48]], [[0.6], [40]], [[1.5], [60]]] as const) {
      const out = ringLayout([...spacings], [...radii]), counts = ringCounts([...spacings], [...radii]);
      expect(counts.reduce((a, b) => a + b, 0) * 2).toBe(out.length);
      let r0 = 0;
      spacings.forEach((s, k) => {
        const expected = (Math.PI * (radii[k] ** 2 - r0 ** 2)) / s ** 2;
        expect(Math.abs(counts[k] - expected) / expected).toBeLessThan(0.02);
        r0 = radii[k];
      });
    }
  });

  it('puts every offset of ring k on the k-th lattice and inside its annulus', () => {
    const spacings = [0.35, 0.7, 1.4], radii = [15, 35, 60], out = ringLayout(spacings, radii), counts = ringCounts(spacings, radii);
    let i = 0;
    counts.forEach((n, k) => {
      for (let j = 0; j < n; j++, i++) {
        expect(ringOf(out, i, radii)).toBe(k);
        for (const v of [out[2 * i], out[2 * i + 1]]) expect(Math.abs(v / spacings[k] - Math.round(v / spacings[k]))).toBeLessThan(1e-4);
      }
    });
  });

  it('never puts two offsets in the same place (the rings do not overlap)', () => {
    const out = ringLayout([0.35, 0.7, 1.4], [15, 35, 60]), seen = new Set<string>();
    for (let i = 0; i < out.length; i += 2) {
      const key = `${Math.round(out[i] / 0.35)},${Math.round(out[i + 1] / 0.35)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('drops rings that a small radius leaves empty (a low tier)', () => {
    const counts = ringCounts([0.35, 0.7, 1.4], [15, 25, 25]);
    expect(counts[2]).toBe(0);
    expect(ringLayout([0.35, 0.7, 1.4], [15, 25, 25]).length).toBe((counts[0] + counts[1]) * 2);
  });
});

describe('snapToCell', () => {
  it('snaps to a whole number of cells', () => {
    const p = snapToCell({ x: 10.3, z: -7.9 }, 1.4);
    expect(p.x / 1.4).toBeCloseTo(Math.round(p.x / 1.4), 9);
    expect(p.z / 1.4).toBeCloseTo(Math.round(p.z / 1.4), 9);
    expect(Math.abs(p.x - 10.3)).toBeLessThanOrEqual(0.7);
    expect(Math.abs(p.z + 7.9)).toBeLessThanOrEqual(0.7);
  });

  it('stays put for small camera moves within a cell, and steps one cell when the camera crosses into the next', () => {
    const a = snapToCell({ x: 14.1, z: 2.9 }, 1.4);
    for (const [dx, dz] of [[0.1, 0], [-0.2, 0.3], [0.3, -0.4], [0.05, 0.05]]) expect(snapToCell({ x: 14.1 + dx, z: 2.9 + dz }, 1.4)).toEqual(a);
    const b = snapToCell({ x: 14.1 + 1.4, z: 2.9 }, 1.4);
    expect(b.x - a.x).toBeCloseTo(1.4, 9);
    expect(b.z).toBe(a.z);
  });

  it('never gives −0', () => {
    expect(Object.is(snapToCell({ x: -0.1, z: -0.2 }, 1).x, -0)).toBe(false);
  });
});

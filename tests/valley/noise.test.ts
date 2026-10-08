import { describe, it, expect } from 'vitest';
import { createNoise2D, fbm, ridged } from '../../src/valley/generate/noise';

const pts = Array.from({ length: 100 }, (_, i) => [i * 3.7 - 150, i * 1.3 + 11.1] as const);

describe('noise', () => {
  it('is deterministic per seed', () => {
    const a = createNoise2D(7), b = createNoise2D(7);
    for (const [x, z] of pts) expect(a(x, z)).toBe(b(x, z));
  });
  it('differs between seeds', () => {
    const a = createNoise2D(7), b = createNoise2D(8);
    expect(pts.some(([x, z]) => a(x, z) !== b(x, z))).toBe(true);
  });
  it('stays within about [-1, 1]', () => {
    const n = createNoise2D(3);
    for (let i = 0; i < 2000; i++) {
      const v = n(i * 0.37, i * 0.91);
      expect(v).toBeGreaterThanOrEqual(-1.1);
      expect(v).toBeLessThanOrEqual(1.1);
    }
  });
  it('fbm is continuous', () => {
    const n = createNoise2D(5);
    for (const [x, z] of pts) expect(Math.abs(fbm(n, x, z, 5) - fbm(n, x + 0.01, z, 5))).toBeLessThan(0.05);
  });
  it('ridged lies in [0, 1]', () => {
    const n = createNoise2D(9);
    for (let i = 0; i < 2000; i++) {
      const v = ridged(n, i * 0.41, i * 0.23, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

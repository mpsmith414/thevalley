import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/rng';

describe('Rng', () => {
  it('gives the same numbers for the same seed', () => {
    const a = new Rng(42), b = new Rng(42);
    const xs = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it('carries on identically from its saved state', () => {
    const a = new Rng(7);
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(a.s);
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(Array.from({ length: 20 }, () => a.next()));
  });
  it('picks and ranges within bounds', () => {
    const r = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const x = r.range(-2, 5);
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThan(5);
      expect(['a', 'b', 'c']).toContain(r.pick(['a', 'b', 'c']));
    }
  });
});

import { describe, expect, it } from 'vitest';
import { beatHz, springStep, swimWave, type Spring } from '../../src/motion/chains';

describe('springStep', () => {
  it('settles on its target without blowing up at a coarse time step', () => {
    let s: Spring = { pos: 0, vel: 0 };
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      s = springStep(s, 1, 60, 12, 0.05);
      peak = Math.max(peak, Math.abs(s.pos));
    }
    expect(s.pos).toBeCloseTo(1, 3);
    expect(peak).toBeLessThan(1.5);
  });

  it('stays steady at a time-lapse step, the stiffest springs too, as if stepped finely', () => {
    let s: Spring = { pos: 0, vel: 0 }, fine: Spring = { pos: 0, vel: 0 }, peak = 0;
    for (let i = 0; i < 40; i++) {
      s = springStep(s, 1, 120, 14, 16 / 60); // Fastest at 60 frames a second
      for (let k = 0; k < 8; k++) fine = springStep(fine, 1, 120, 14, 2 / 60);
      peak = Math.max(peak, Math.abs(s.pos));
    }
    expect(peak).toBeLessThan(1.5);
    expect(s.pos).toBeCloseTo(fine.pos, 9);
    const one = springStep({ pos: 0, vel: 0 }, 1, 120, 14, 1 / 60); // a frame at 60 fps: one plain step, as before
    expect(one.vel).toBe(120 / 60);
    expect(one.pos).toBe(one.vel / 60);
  });
});

describe('swimWave', () => {
  it('grows towards the tail: the first segment swings less than 0.3 of the last', () => {
    const n = 5, peak = (i: number) => {
      let p = 0;
      for (let k = 0; k < 200; k++) p = Math.max(p, Math.abs(swimWave(i, n, k / 200, 1)));
      return p;
    };
    const peaks = [0, 1, 2, 3, 4].map(peak);
    for (let i = 1; i < n; i++) expect(peaks[i]).toBeGreaterThan(peaks[i - 1]);
    expect(peaks[0]).toBeLessThan(0.3 * peaks[n - 1]);
    expect(peaks[n - 1]).toBeCloseTo(1, 3);
  });

  it('travels from head to tail, one body length long', () => {
    // segment i+1 reaches segment i's phase a 1/n of a cycle later
    const n = 6;
    for (const t of [0.1, 0.37, 0.8]) {
      const a = swimWave(2, n, t, 1) / (0.15 + 0.85 * (3 / n) ** 2);
      const b = swimWave(3, n, t + 1 / n, 1) / (0.15 + 0.85 * (4 / n) ** 2);
      expect(b).toBeCloseTo(a, 9);
    }
  });
});

describe('beatHz', () => {
  it('beats slowly at rest and faster with speed per body length', () => {
    expect(beatHz(0, 1)).toBe(1.2);
    expect(beatHz(1, 0.5)).toBeCloseTo(1.2 + 5, 9);
  });
});

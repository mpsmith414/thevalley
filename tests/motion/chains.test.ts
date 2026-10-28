import { describe, expect, it } from 'vitest';
import { springStep, undulation, type Spring } from '../../src/motion/chains';

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

describe('undulation', () => {
  it('travels from head to tail', () => {
    // segment i+1 reaches the same angle a little later than segment i
    const lag = 0.12;
    const a0 = undulation(0, 8, 0.25, 1, lag);
    const a1Later = undulation(1, 8, 0.25 + lag, 1, lag);
    expect(Math.sign(a0)).toBe(Math.sign(a1Later));
    expect(Math.abs(a1Later)).toBeGreaterThan(Math.abs(a0)); // and grows towards the tail
  });

  it('is still at the start of a cycle for the head', () => {
    expect(undulation(0, 8, 0, 1, 0.1)).toBeCloseTo(0, 10);
  });
});

import { describe, expect, it } from 'vitest';
import { ViewBlend } from '../../src/views/blend';
import { nearPlane } from '../../src/views/types';

const from = { pos: { x: 0, y: 2, z: 0 }, yaw: 0.5, pitch: 0.2 };
const to = { pos: { x: 10, y: 4, z: -6 }, yaw: 1, pitch: -0.1 };

describe('ViewBlend', () => {
  it('returns the old pose at the start and the new one after 0.7 s', () => {
    const b = new ViewBlend();
    b.start(from);
    expect(b.active).toBe(true);
    expect(b.apply(to, 0)).toEqual(from);
    let pose = from;
    for (let t = 0; t < 0.7; t += 1 / 60) pose = b.apply(to, 1 / 60);
    pose = b.apply(to, 1 / 60);
    expect(pose).toEqual(to);
    expect(b.active).toBe(false);
  });

  it('moves smoothly between: halfway is the middle, and never overshoots', () => {
    const b = new ViewBlend();
    b.start(from);
    const half = b.apply(to, 0.35);
    expect(half.pos.x).toBeCloseTo(5, 5);
    expect(half.pitch).toBeCloseTo(0.05, 5);
    let last = -1;
    for (let i = 0; i < 20; i++) {
      const p = b.apply(to, 0.05);
      expect(p.pos.x).toBeGreaterThanOrEqual(last);
      expect(p.pos.x).toBeLessThanOrEqual(10);
      last = p.pos.x;
    }
  });

  it('turns the short way round: yaw from 3.0 to -3.0 passes through pi, not zero', () => {
    const b = new ViewBlend();
    b.start({ ...from, yaw: 3 });
    const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
    for (let t = 0; t < 0.65; t += 0.05) expect(Math.cos(b.apply({ ...to, yaw: -3 }, 0.05).yaw)).toBeLessThan(-0.98);
    expect(wrap(b.apply({ ...to, yaw: -3 }, 1).yaw)).toBeCloseTo(wrap(-3), 9);
  });

  it('blends a bank, then passes a moving target straight through once over', () => {
    const b = new ViewBlend();
    b.start({ ...from, roll: 0.2 });
    expect(b.apply({ ...to, roll: 0 }, 0.35).roll).toBeCloseTo(0.1, 5);
    b.apply(to, 1);
    expect(b.apply({ ...to, yaw: 2 }, 0.1).yaw).toBe(2);
  });

  it('a new start begins again', () => {
    const b = new ViewBlend();
    b.start(from, 0.6);
    b.apply(to, 1);
    b.start(to, 0.6);
    expect(b.active).toBe(true);
    expect(b.apply(from, 0)).toEqual(to);
  });
});

describe('nearPlane', () => {
  it('is 5% of the size, from 1 cm to 10 cm', () => {
    expect(nearPlane(0.1)).toBe(0.01);
    expect(nearPlane(1.5)).toBe(0.075);
    expect(nearPlane(5)).toBe(0.1);
  });
});

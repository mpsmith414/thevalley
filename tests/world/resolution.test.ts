import { describe, expect, it } from 'vitest';
import { ResolutionScaler } from '../../src/world/resolution';
import { mulberry32 } from '../../src/util/rng';

/** Push `n` frames of `ms` each; returns the scale after each one. */
const feed = (s: ResolutionScaler, n: number, ms: number | (() => number)) =>
  Array.from({ length: n }, () => s.push(typeof ms === 'number' ? ms : ms()));

describe('ResolutionScaler', () => {
  it('starts at full resolution and holds it at a steady 60 fps', () => {
    const s = new ResolutionScaler(0.7);
    expect(feed(s, 600, 16.7).every((x) => x === 1)).toBe(true);
  });

  it('scales steady 20 ms frames down to its floor and stays there', () => {
    const s = new ResolutionScaler(0.7);
    const out = feed(s, 600, 20); // 12 s
    expect(out[out.length - 1]).toBe(0.7);
    expect(feed(s, 600, 20).every((x) => x === 0.7)).toBe(true);
  });

  it('steps down by ×0.92 at a time', () => {
    const s = new ResolutionScaler(0.5);
    const steps = [...new Set(feed(s, 2000, 20))];
    for (let i = 1; i < steps.length - 1; i++) expect(steps[i] / steps[i - 1]).toBeCloseTo(0.92, 6);
  });

  it('recovers to 1 on steady 10 ms frames', () => {
    const s = new ResolutionScaler(0.7);
    feed(s, 600, 20);
    expect(s.push(20)).toBe(0.7);
    const out = feed(s, 3000, 10);
    expect(out[out.length - 1]).toBe(1);
    const steps = [...new Set(out)];
    for (let i = 1; i < steps.length - 1; i++) expect(steps[i] / steps[i - 1]).toBeCloseTo(1.04, 6);
  });

  it('steps up on exactly the 120th frame in a row with a fast median, then every 120 frames', () => {
    const s = new ResolutionScaler(0.7);
    feed(s, 600, 20); // at the floor, with a window of 20 ms frames and the last change long past
    const out = feed(s, 400, 10);
    const changes = out.map((x, i) => [x, i] as const).filter(([x], i) => x !== (i ? out[i - 1] : 0.7)).map(([, i]) => i + 1);
    // the median turns fast on the 31st 10 ms frame (31 of the 60 are fast), so the run reaches 120 on frame 150
    expect(changes.slice(0, 2)).toEqual([150, 270]);
  });

  it('waits for 120 fast frames in a row before stepping up', () => {
    const s = new ResolutionScaler(0.7);
    feed(s, 600, 20);
    feed(s, 59, 10); // the median turns fast after 31 of these
    const before = s.push(10);
    // a slow-ish (but not slow) stretch breaks the run
    feed(s, 60, 16);
    const out = feed(s, 119, 10); // the median is fast again only after 31 of these, so 120 in a row are not yet in
    expect(out.every((x) => x === before)).toBe(true);
  });

  it('never changes twice within 0.5 s of frames, at any frame rate', () => {
    for (const pattern of [20, 40, 100, 5, 2]) {
      const s = new ResolutionScaler(0.3);
      let t = 0, last = s.push(30), changedAt = -Infinity;
      const ms = [...Array(400).fill(pattern), ...Array(4000).fill(pattern < 14 ? 30 : 5), ...Array(4000).fill(3)];
      for (const m of ms) {
        t += m;
        const x = s.push(m);
        if (x !== last) {
          expect(t - changedAt).toBeGreaterThanOrEqual(500);
          changedAt = t;
          last = x;
        }
      }
    }
  });

  it('stays within [min, 1] for any frames', () => {
    const rng = mulberry32(7);
    for (const min of [0.6, 0.7, 0.9]) {
      const s = new ResolutionScaler(min);
      for (let i = 0; i < 20000; i++) {
        // long stretches of light or heavy frames, with spikes
        const heavy = Math.floor(i / 700) % 2 === 0;
        const x = s.push(rng() < 0.05 ? 100 : heavy ? 15 + rng() * 25 : 4 + rng() * 9);
        expect(x).toBeGreaterThanOrEqual(min);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ignores a few spikes (it reads the median)', () => {
    const s = new ResolutionScaler(0.7);
    const out = feed(s, 600, () => 16.7);
    for (let i = 0; i < 600; i++) out.push(s.push(i % 5 === 0 ? 60 : 16.7)); // every 5th frame a hitch
    expect(out.every((x) => x === 1)).toBe(true);
  });
});

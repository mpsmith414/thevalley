import { describe, expect, it } from 'vitest';
import { GUST_SPEED, createWind, gustAt, updateWind } from '../../src/plants/wind';

describe('gustAt', () => {
  it('stays in 0..1 everywhere and at every time', () => {
    const w = createWind();
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 400; t++) {
      updateWind(w, 0.5, 7);
      for (let i = 0; i < 40; i++) {
        const g = gustAt(w, -800 + i * 41.3, 800 - i * 37.9);
        lo = Math.min(lo, g); hi = Math.max(hi, g);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1);
    expect(hi - lo).toBeGreaterThan(0.5); // it really varies: calm patches and gusts
  });

  it('carries a peak downwind as time passes', () => {
    const w = { ...createWind(), dirX: 1, dirZ: 0 };
    // the strongest gust along a west–east line at z = 30
    const peak = () => {
      let best = -1, at = 0;
      for (let x = 0; x <= 600; x += 0.5) {
        const g = gustAt(w, x, 30);
        if (g > best) (best = g), (at = x);
      }
      return { best, at };
    };
    const before = peak();
    // follow that peak for 5 s: it must have moved east (downwind) by the travel speed
    const g0 = gustAt(w, before.at, 30);
    w.offX += GUST_SPEED * 5; // what 5 s of wind does to the field (direction fixed here)
    w.time += 5;
    expect(gustAt(w, before.at + GUST_SPEED * 5, 30)).toBeCloseTo(g0, 6);
    expect(Math.abs(gustAt(w, before.at, 30) - g0)).toBeGreaterThan(1e-3); // and has left where it was
  });

  it('moves the field along the wind when stepped by updateWind', () => {
    const w = createWind();
    updateWind(w, 0.01, 3);
    const { dirX, dirZ } = w, x = 120, z = -40, g0 = gustAt(w, x, z);
    updateWind(w, 0.25, 3); // a short step: the direction barely turns
    const d = GUST_SPEED * 0.25;
    expect(gustAt(w, x + dirX * d, z + dirZ * d)).toBeCloseTo(g0, 2);
  });
});

describe('updateWind', () => {
  it('keeps strength in 0.25–0.7 and the direction within ±25° of west→east over 10 000 steps', () => {
    const w = createWind();
    let lo = Infinity, hi = -Infinity, maxAngle = 0;
    for (let i = 0; i < 10_000; i++) {
      updateWind(w, 0.1 + (i % 7) * 0.05, 42);
      lo = Math.min(lo, w.strength); hi = Math.max(hi, w.strength);
      maxAngle = Math.max(maxAngle, Math.abs(Math.atan2(w.dirZ, w.dirX)));
      expect(Math.hypot(w.dirX, w.dirZ)).toBeCloseTo(1, 6);
    }
    expect(lo).toBeGreaterThanOrEqual(0.25);
    expect(hi).toBeLessThanOrEqual(0.7);
    expect(hi - lo).toBeGreaterThan(0.2); // it wanders, not stuck
    expect(maxAngle).toBeLessThanOrEqual((25 * Math.PI) / 180 + 1e-9);
    expect(maxAngle).toBeGreaterThan((10 * Math.PI) / 180);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const run = (seed: number) => {
      const w = createWind();
      for (let i = 0; i < 500; i++) updateWind(w, 0.2, seed);
      return [w.strength, w.dirX, w.dirZ, w.offX, w.offZ];
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('wanders slowly: strength changes by under 1% per frame', () => {
    const w = createWind();
    let prev = NaN, worst = 0;
    for (let i = 0; i < 6000; i++) {
      updateWind(w, 1 / 60, 9);
      if (prev === prev) worst = Math.max(worst, Math.abs(w.strength - prev));
      prev = w.strength;
    }
    expect(worst).toBeLessThan(0.01);
  });
});

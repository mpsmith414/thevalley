import { describe, expect, it } from 'vitest';
import { GUST_SPEED, WRAP, createWind, gustAt, updateWind } from '../../src/plants/wind';
import { mulberry32 } from '../../src/util/rng';

/** `gustAt` at eight fixed points of a fixed state, as of the integer-lacunarity field (checked against the GPU twin). */
const GOLDEN = [0.0186471, 0.1852198, 0.0113437, 0.9083279, 0.1635827, 0.9719651, 0.6159919, 0.9653679];

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

  it('carries its gust features downwind at about 6 m/s as updateWind runs', () => {
    const w = createWind();
    updateWind(w, 0.01, 11);
    // a spread of points, and the field there now
    const pts = Array.from({ length: 400 }, (_, i) => [(i % 20) * 11 - 100, Math.floor(i / 20) * 11 - 100]);
    const g0 = pts.map(([x, z]) => gustAt(w, x, z)), dir0 = [w.dirX, w.dirZ];
    const T = 5;
    for (let i = 0; i < T * 60; i++) updateWind(w, 1 / 60, 11);
    // the shift d (m) along the wind that best maps the field now back onto the field then
    const dx = (dir0[0] + w.dirX) / 2, dz = (dir0[1] + w.dirZ) / 2, norm = Math.hypot(dx, dz);
    let best = Infinity, at = 0;
    for (let d = -60; d <= 120; d += 0.5) {
      let err = 0;
      pts.forEach(([x, z], i) => { const e = gustAt(w, x + (dx / norm) * d, z + (dz / norm) * d) - g0[i]; err += e * e; });
      if (err < best) (best = err), (at = d);
    }
    expect(at).toBeGreaterThan(GUST_SPEED * T * 0.7);
    expect(at).toBeLessThan(GUST_SPEED * T * 1.3);
  });

  it('repeats exactly over the offset wrap, so the field cannot jump when the offset wraps', () => {
    const w = { ...createWind(), offX: 1234.5, offZ: 9876.5 };
    const shifted = { ...w, offX: w.offX + WRAP, offZ: w.offZ + 2 * WRAP };
    const rng = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const x = (rng() - 0.5) * 3200, z = (rng() - 0.5) * 3200;
      expect(Math.abs(gustAt(shifted, x, z) - gustAt(w, x, z))).toBeLessThan(1e-6);
    }
  });

  it('is continuous while updateWind wraps the offset', () => {
    const w = { ...createWind(), offX: WRAP - 1, offZ: WRAP - 0.5 }, seed = 21;
    const pts = Array.from({ length: 60 }, (_, i) => [-300 + i * 13.7, 200 - i * 9.3]);
    let prev = pts.map(([x, z]) => gustAt(w, x, z)), worst = 0, wrapped = false;
    for (let i = 0; i < 600; i++) {
      const before = w.offX;
      updateWind(w, 1 / 60, seed);
      wrapped ||= w.offX < before;
      const now = pts.map(([x, z]) => gustAt(w, x, z));
      now.forEach((g, k) => (worst = Math.max(worst, Math.abs(g - prev[k]))));
      prev = now;
    }
    expect(wrapped).toBe(true); // the offset really did wrap in this run
    expect(worst).toBeLessThan(0.02); // a frame (0.1 m of travel) moves the field a hair; a jump would be 10× that
  });

  it('keeps its values: a pinned table (so the CPU side cannot drift from the shader unseen)', () => {
    const w = { ...createWind(), offX: 123.4, offZ: 567.8 };
    const pts: [number, number][] = [[0, 0], [100, -50], [-250, 300], [250, -120], [-700, -600], [33.3, 77.7], [800, -800], [-12.5, 640]];
    const got = pts.map(([x, z]) => gustAt(w, x, z));
    GOLDEN.forEach((g, i) => expect(got[i]).toBeCloseTo(g, 6));
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

import { describe, expect, it } from 'vitest';
import { moonDirection, moonPhase, sunDirection } from '../../src/world/clock';
import type { Grade } from '../../src/render/grade';
import { lightingAt, type LightState } from '../../src/world/lighting';

/** The lighting at `hour` on day 0, with the moon of that moment. */
const at = (hour: number, day = 0): LightState => {
  const hours = day * 24 + hour;
  return lightingAt(hour, sunDirection(hour), moonDirection(hours), moonPhase(hours));
};

describe('lightingAt', () => {
  // Exposures are for the Valley's Neutral tone mapping (AgX's were 0.95 by day, 2.2 at night): Neutral keeps more contrast,
  // so night and the low sun need more exposure to stay readable.
  it('is sunlit at noon with exposure 1', () => {
    const s = at(12);
    expect(s.key).toBe('sun');
    expect(s.exposure).toBeCloseTo(1, 9);
    expect(s.keyIntensity).toBeCloseTo(3, 9);
    expect(s.stars).toBe(0);
    expect(s.keyDir).toEqual(sunDirection(12));
  });

  it('is moonlit at midnight, with every star out and a raised exposure', () => {
    const s = at(0);
    expect(s.key).toBe('moon');
    expect(s.stars).toBeCloseTo(1, 6);
    expect(s.exposure).toBeGreaterThanOrEqual(4);
    expect(s.keyColor).toBe('#7f9bff');
  });

  it('scales the moonlight by how full and how high the moon is', () => {
    const v = { x: 0, y: 1, z: 0 }, below = { x: 0, y: -1, z: 0 }, sun = sunDirection(0);
    const full = lightingAt(0, sun, v, 0.5), half = lightingAt(0, sun, v, 0.25), newMoon = lightingAt(0, sun, v, 0);
    expect(full.keyIntensity).toBeGreaterThan(half.keyIntensity);
    expect(half.keyIntensity).toBeGreaterThan(newMoon.keyIntensity);
    expect(newMoon.keyIntensity).toBeGreaterThan(0);
    expect(lightingAt(0, sun, below, 0.5).keyIntensity).toBe(0);
    expect(lightingAt(0, sun, { x: 0, y: -0.2, z: 1 }, 0.5).keyIntensity).toBe(0); // well below the horizon
  });

  it('has its dawn mist peak near 5.5 h and none at noon', () => {
    let best = 0, bestHour = 0;
    for (let h = 0; h < 24; h += 0.05) {
      const m = at(h).mist;
      if (m > best) [best, bestHour] = [m, h];
    }
    expect(Math.abs(bestHour - 5.5)).toBeLessThan(0.1);
    expect(best).toBeGreaterThan(0.9);
    expect(at(12).mist).toBe(0);
    expect(at(2).mist).toBe(0);
    expect(at(12).fogDensity).toBeCloseTo(0.00025, 9);
    expect(at(5.5).fogDensity).toBeGreaterThan(0.00025);
  });

  it('switches the key to the moon below −3° of sun elevation', () => {
    const down = (deg: number) => ({ x: 0, y: Math.sin((deg * Math.PI) / 180), z: Math.cos((deg * Math.PI) / 180) });
    const moon = { x: 0, y: 1, z: 0 };
    expect(lightingAt(20, down(-2.9), moon, 0.5).key).toBe('sun');
    expect(lightingAt(20, down(-3.1), moon, 0.5).key).toBe('moon');
    expect(lightingAt(20, down(-3.1), moon, 0.5).keyDir).toEqual(moon);
  });

  it('interpolates the table by sun elevation', () => {
    const sunAt = (deg: number) => ({ x: 0, y: Math.sin((deg * Math.PI) / 180), z: Math.cos((deg * Math.PI) / 180) });
    const moon = { x: 0, y: -1, z: 0 };
    expect(lightingAt(9, sunAt(15), moon, 0).exposure).toBeCloseTo(1.1, 9);
    expect(lightingAt(9, sunAt(15), moon, 0).keyColor).toBe('#ffe0b8');
    expect(lightingAt(9, sunAt(10), moon, 0).keyIntensity).toBeCloseTo(2.0, 6);
    expect(lightingAt(9, sunAt(2.5), moon, 0).exposure).toBeCloseTo(1.55, 6);
    expect(lightingAt(9, sunAt(-30), moon, 0).exposure).toBeCloseTo(4.6, 9);
    expect(lightingAt(9, sunAt(80), moon, 0).keyIntensity).toBeCloseTo(3, 9);
  });

  it('gives only valid #rrggbb colours, all day', () => {
    for (let h = 0; h < 48; h += 0.25) {
      const s = at(h % 24, Math.floor(h / 24));
      for (const c of [s.keyColor, s.skyColor, s.groundColor, s.fogColor]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      for (const n of [s.keyIntensity, s.hemiIntensity, s.exposure, s.fogDensity, s.stars, s.mist]) expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('has no jump in the key intensity across sunrise, the key switch or moonrise', () => {
    const dir = (deg: number) => ({ x: 0, y: Math.sin((deg * Math.PI) / 180), z: Math.cos((deg * Math.PI) / 180) });
    const sun = dir(-30), farMoon = dir(90);
    let prev = lightingAt(20, dir(-20), farMoon, 0.5).keyIntensity;
    for (let d = -19.95; d <= 70; d += 0.05) {
      const k = lightingAt(20, dir(d), farMoon, 0.5).keyIntensity;
      expect(Math.abs(k - prev)).toBeLessThanOrEqual(0.05);
      prev = k;
    }
    prev = lightingAt(0, sun, dir(-10), 0.5).keyIntensity;
    for (let d = -9.95; d <= 10; d += 0.05) {
      const k = lightingAt(0, sun, dir(d), 0.5).keyIntensity;
      expect(Math.abs(k - prev)).toBeLessThanOrEqual(0.05);
      prev = k;
    }
  });

  it('has the key intensity reach 0 at the sun-to-moon switch', () => {
    const dir = (deg: number) => ({ x: 0, y: Math.sin((deg * Math.PI) / 180), z: Math.cos((deg * Math.PI) / 180) });
    expect(lightingAt(20, dir(-3), dir(60), 0.5).keyIntensity).toBeCloseTo(0, 6);
    expect(lightingAt(20, dir(-0.5), dir(60), 0.5).keyIntensity).toBeGreaterThan(0);
    expect(lightingAt(20, dir(-4), dir(60), 0.5).keyIntensity).toBeGreaterThan(0);
  });

  it('puts the sun key out as the sun crosses the horizon (it would light the animals from under the ground)', () => {
    const dir = (deg: number) => ({ x: 0, y: Math.sin((deg * Math.PI) / 180), z: Math.cos((deg * Math.PI) / 180) });
    const below = dir(-60); // no moonlight, so only the sun's key is left
    for (const d of [-1, -1.5, -2, -2.9]) expect(lightingAt(20, dir(d), below, 0.5).keyIntensity).toBe(0);
    expect(lightingAt(20, dir(0), below, 0.5).keyIntensity).toBeCloseTo(0.7 * 0.5, 6); // half way through the fade
    expect(lightingAt(20, dir(1), below, 0.5).keyIntensity).toBeCloseTo(0.7 + (1.6 - 0.7) / 5, 6);
  });

  describe('grade', () => {
    const sunAt = (deg: number) => ({ x: 0, y: Math.sin((deg * Math.PI) / 180), z: Math.cos((deg * Math.PI) / 180) });
    const below = { x: 0, y: -1, z: 0 };
    /** Every grade field as one flat list of numbers. */
    const flat = (g: Grade) => [g.warmth, g.tint, ...g.lift, ...g.gamma, ...g.gain, g.contrast, g.saturation, g.vibrance, g.vignette];

    it('is given at every hour, with finite fields', () => {
      for (let h = 0; h < 24; h += 0.25) {
        const g = at(h).grade;
        expect(g).toBeDefined();
        expect(flat(g)).toHaveLength(15);
        for (const n of flat(g)) expect(Number.isFinite(n)).toBe(true);
      }
    });

    it('is continuous across every row of the table', () => {
      for (const e of [-18, -8, -3, 0, 5, 15, 40, 65]) {
        const lo = flat(lightingAt(9, sunAt(e - 0.01), below, 0).grade), hi = flat(lightingAt(9, sunAt(e + 0.01), below, 0).grade);
        lo.forEach((v, i) => expect(Math.abs(v - hi[i])).toBeLessThan(1e-3));
      }
    });

    it('has each row of the table at its own elevation, and the mean of two rows half way between', () => {
      const g = (e: number) => lightingAt(9, sunAt(e), below, 0).grade;
      const close = (got: number[], want: number[]) => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));
      close([g(-8).saturation, g(-8).warmth], [0.75, 0.2]);
      close(g(-3).lift, [0.012, 0.012, 0.016]);
      expect(g(-3).vibrance).toBeCloseTo(0.05, 6);
      close(g(0).gain, [1.02, 1, 0.97]);
      expect(g(0).saturation).toBeCloseTo(0.95, 6);
      close([g(5).warmth, g(5).contrast], [0.2, 1.05]);
      close(g(5).gain, [1.03, 1.01, 0.96]);
      close(g(15).lift, [0.008, 0.004, 0.002]);
      expect(g(15).warmth).toBeCloseTo(0.08, 6);
      close(g(40).lift, [0.01, 0.005, 0]);
      close([g(10).warmth, g(10).contrast], [(0.2 + 0.08) / 2, (1.05 + 1.04) / 2]);
      close([g(-5.5).saturation], [(0.75 + 0.85) / 2]);
    });

    it('is desaturated deep in the night and has no warmth at noon', () => {
      expect(lightingAt(0, sunAt(-18), below, 0).grade.saturation).toBeLessThan(0.8);
      expect(lightingAt(0, sunAt(-40), below, 0).grade.saturation).toBeLessThan(0.8);
      expect(at(12).grade.warmth).toBe(0);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { moonDirection, moonPhase, sunDirection } from '../../src/world/clock';
import { lightingAt, type LightState } from '../../src/world/lighting';

/** The lighting at `hour` on day 0, with the moon of that moment. */
const at = (hour: number, day = 0): LightState => {
  const hours = day * 24 + hour;
  return lightingAt(hour, sunDirection(hour), moonDirection(hours), moonPhase(hours));
};

describe('lightingAt', () => {
  it('is sunlit at noon with exposure 0.95', () => {
    const s = at(12);
    expect(s.key).toBe('sun');
    expect(s.exposure).toBeCloseTo(0.95, 9);
    expect(s.keyIntensity).toBeCloseTo(3, 9);
    expect(s.stars).toBe(0);
    expect(s.keyDir).toEqual(sunDirection(12));
  });

  it('is moonlit at midnight, with every star out and a raised exposure', () => {
    const s = at(0);
    expect(s.key).toBe('moon');
    expect(s.stars).toBeCloseTo(1, 6);
    expect(s.exposure).toBeGreaterThanOrEqual(2);
    expect(s.keyColor).toBe('#9db4ff');
  });

  it('scales the moonlight by how full and how high the moon is', () => {
    const v = { x: 0, y: 1, z: 0 }, below = { x: 0, y: -1, z: 0 }, sun = sunDirection(0);
    const full = lightingAt(0, sun, v, 0.5), half = lightingAt(0, sun, v, 0.25), newMoon = lightingAt(0, sun, v, 0);
    expect(full.keyIntensity).toBeGreaterThan(half.keyIntensity);
    expect(half.keyIntensity).toBeGreaterThan(newMoon.keyIntensity);
    expect(newMoon.keyIntensity).toBeGreaterThan(0);
    expect(lightingAt(0, sun, below, 0.5).keyIntensity).toBe(0);
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
    expect(at(12).fogDensity).toBeCloseTo(0.00028, 9);
    expect(at(5.5).fogDensity).toBeGreaterThan(0.00028);
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
    expect(lightingAt(9, sunAt(15), moon, 0).exposure).toBeCloseTo(0.95, 9);
    expect(lightingAt(9, sunAt(15), moon, 0).keyColor).toBe('#ffe0b8');
    expect(lightingAt(9, sunAt(10), moon, 0).keyIntensity).toBeCloseTo(2.0, 6);
    expect(lightingAt(9, sunAt(2.5), moon, 0).exposure).toBeCloseTo(1.15, 6);
    expect(lightingAt(9, sunAt(-30), moon, 0).exposure).toBeCloseTo(2.2, 9);
    expect(lightingAt(9, sunAt(80), moon, 0).keyIntensity).toBeCloseTo(3, 9);
  });

  it('gives only valid #rrggbb colours, all day', () => {
    for (let h = 0; h < 48; h += 0.25) {
      const s = at(h % 24, Math.floor(h / 24));
      for (const c of [s.keyColor, s.skyColor, s.groundColor, s.fogColor]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      for (const n of [s.keyIntensity, s.hemiIntensity, s.exposure, s.fogDensity, s.stars, s.mist]) expect(Number.isFinite(n)).toBe(true);
    }
  });
});

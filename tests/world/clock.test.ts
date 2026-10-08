import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEED, START_HOUR, ValleyClock, elevationDeg, moonDirection, moonPhase, sunDirection } from '../../src/world/clock';
import { len } from '../../src/util/vec';

/** The hour (to 0.01 h) in [a, b] where the sun's elevation crosses 0. */
function crossing(a: number, b: number): number {
  const up = elevationDeg(sunDirection(a)) < 0;
  for (let h = a; h <= b; h += 0.01) if ((elevationDeg(sunDirection(h)) < 0) !== up) return h;
  return NaN;
}

describe('sun', () => {
  it('stands 65.4° high at noon and 18.6° below the horizon at midnight', () => {
    expect(elevationDeg(sunDirection(12))).toBeCloseTo(65.4, 0);
    expect(Math.abs(elevationDeg(sunDirection(12)) - 65.4)).toBeLessThan(0.5);
    expect(Math.abs(elevationDeg(sunDirection(0)) + 18.6)).toBeLessThan(0.5);
  });

  it('rises between 3.8 and 4.4 h and sets between 19.6 and 20.2 h', () => {
    const rise = crossing(2, 7), set = crossing(17, 22);
    expect(rise).toBeGreaterThan(3.8);
    expect(rise).toBeLessThan(4.4);
    expect(set).toBeGreaterThan(19.6);
    expect(set).toBeLessThan(20.2);
  });

  it('is in the south at noon and east of south in the morning', () => {
    const noon = sunDirection(12), morning = sunDirection(6);
    expect(noon.z).toBeGreaterThan(0);
    expect(Math.abs(noon.x)).toBeLessThan(1e-9);
    expect(morning.x).toBeGreaterThan(0);
    expect(sunDirection(18).x).toBeLessThan(0);
  });

  it('is a unit vector', () => {
    for (let h = 0; h < 24; h += 1.7) expect(len(sunDirection(h))).toBeCloseTo(1, 9);
  });
});

describe('moon', () => {
  it('has a 29.53-day phase cycle starting at 0.3', () => {
    expect(moonPhase(0)).toBeCloseTo(0.3, 9);
    expect(moonPhase(29.53 * 24)).toBeCloseTo(0.3, 9);
    expect(moonPhase(29.53 * 12)).toBeCloseTo(0.8, 9);
    for (let h = 0; h < 2000; h += 37) {
      expect(moonPhase(h)).toBeGreaterThanOrEqual(0);
      expect(moonPhase(h)).toBeLessThan(1);
    }
  });

  it('sits opposite the sun when full, and shares its hour angle when new', () => {
    const full = (0.5 - 0.3) * 29.53 * 24, newMoon = (1 - 0.3) * 29.53 * 24;
    const at = (hours: number) => ({ s: sunDirection(hours % 24), m: moonDirection(hours) });
    const f = at(full), n = at(newMoon);
    expect(f.s.x * f.m.x + f.s.y * f.m.y + f.s.z * f.m.z).toBeCloseTo(-1, 6);
    expect(n.m.x).toBeCloseTo(n.s.x, 6); // same hour angle; the declination is the sun's mirrored
    expect(len(moonDirection(123.4))).toBeCloseTo(1, 9);
  });
});

describe('ValleyClock', () => {
  it('starts at the start hour and advances 1 h in 60 s at the default speed', () => {
    const c = new ValleyClock();
    expect(c.hour).toBe(START_HOUR);
    expect(c.speed).toBe(DEFAULT_SPEED);
    for (let i = 0; i < 600; i++) c.update(0.1);
    expect(c.hour).toBeCloseTo(START_HOUR + 1, 9);
    expect(c.day).toBe(0);
  });

  it('wraps the hour and counts days', () => {
    const c = new ValleyClock();
    c.update(60 * 20); // 20 h later: 1:30 on day 1
    expect(c.hour).toBeCloseTo(1.5, 9);
    expect(c.day).toBe(1);
  });

  it('jumps forward to the next occurrence of an hour, never backwards', () => {
    const c = new ValleyClock();
    c.jumpTo(4.5);
    expect(c.hour).toBeCloseTo(4.5, 9);
    expect(c.day).toBe(1);
    expect(c.hours).toBeCloseTo(28.5, 9);
    c.jumpTo(12);
    expect(c.hours).toBeCloseTo(36, 9);
    c.jumpTo(12);
    expect(c.hours).toBeCloseTo(36, 9);
  });

  it('stops while paused', () => {
    const c = new ValleyClock();
    c.paused = true;
    c.update(1000);
    expect(c.hour).toBe(START_HOUR);
    c.paused = false;
    c.update(60);
    expect(c.hour).toBeCloseTo(START_HOUR + 1, 9);
  });
});

import { describe, expect, it } from 'vitest';
import { LAYERS, mixAt, type Listener } from '../../src/audio/mix';
import { elevationDeg, sunDirection } from '../../src/world/clock';

/** A listener in the forest at noon, standing at the ground, far from any water, in a moderate breeze. */
const base = (o: Partial<Listener> = {}): Listener => ({
  pos: { x: 0, y: 0, z: 0 }, hour: 12, sunElevation: elevationDeg(sunDirection(12)), gust: 0.3, strength: 0.5,
  heightAboveGround: 1.7, lakeDistance: 500, riverDistance: 500, riverSlope: 0.01, forestAround: 1, ...o,
});
const midnight = { hour: 0, sunElevation: elevationDeg(sunDirection(0)) };

describe('mixAt', () => {
  it('has birds at noon in the forest and none at midnight', () => {
    expect(mixAt(base()).birds).toBeGreaterThan(0.4);
    expect(mixAt(base(midnight)).birds).toBe(0);
  });

  it('has the night layer full at midnight and silent at noon', () => {
    expect(mixAt(base(midnight)).night).toBe(1);
    expect(mixAt(base()).night).toBe(0);
  });

  it('makes the river louder close up and on steep stretches', () => {
    const near = mixAt(base({ riverDistance: 3 })).river, far = mixAt(base({ riverDistance: 60 })).river;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(mixAt(base({ riverDistance: 20, riverSlope: 0.1 })).river).toBeGreaterThan(mixAt(base({ riverDistance: 20, riverSlope: 0.01 })).river);
    expect(mixAt(base({ riverDistance: 120 })).river).toBe(0);
  });

  it('silences the lake beyond 80 m and has it full at the shore', () => {
    expect(mixAt(base({ lakeDistance: 81 })).lake).toBe(0);
    expect(mixAt(base({ lakeDistance: 200 })).lake).toBe(0);
    expect(mixAt(base({ lakeDistance: 2 })).lake).toBe(1);
    expect(mixAt(base({ lakeDistance: 40 })).lake).toBeGreaterThan(0);
  });

  it('makes the wind grow with height, and the forest rustle fade with it', () => {
    const heights = [0, 10, 40, 80, 150];
    const wind = heights.map((h) => mixAt(base({ heightAboveGround: h })).wind);
    for (let i = 1; i < wind.length; i++) expect(wind[i]).toBeGreaterThanOrEqual(wind[i - 1]);
    expect(wind[4]).toBeGreaterThan(wind[0]);
    expect(mixAt(base({ heightAboveGround: 50 })).forest).toBe(0);
    expect(mixAt(base({ heightAboveGround: 1 })).forest).toBeGreaterThan(0);
  });

  it('follows the brief formulas exactly', () => {
    const m = mixAt(base({ gust: 0.5, strength: 0.4, heightAboveGround: 200, forestAround: 0.5 }));
    expect(m.wind).toBeCloseTo(Math.min(1, 0.15 + 0.2 + 0.175), 10);
    expect(m.forest).toBe(0);
    expect(mixAt(base({ forestAround: 0 })).birds).toBeCloseTo(0.4, 10);
    expect(mixAt(base({ forestAround: 0.5, strength: 0.5, heightAboveGround: 0 })).forest).toBeCloseTo(0.5 * 0.65, 10);
  });

  it('keeps every gain in [0, 1] over a sweep of listeners', () => {
    for (const hour of [0, 3, 5, 6, 12, 20, 21.5, 23])
      for (const h of [0, 3, 30, 300])
        for (const s of [0, 0.5, 1])
          for (const d of [0, 10, 50, 200]) {
            const m = mixAt(base({ hour, sunElevation: elevationDeg(sunDirection(hour)), heightAboveGround: h, strength: s, gust: s,
              lakeDistance: d, riverDistance: d, riverSlope: s / 5, forestAround: s }));
            for (const k of LAYERS) {
              expect(m[k], `${k} ${hour} ${h} ${s} ${d}`).toBeGreaterThanOrEqual(0);
              expect(m[k], `${k} ${hour} ${h} ${s} ${d}`).toBeLessThanOrEqual(1);
            }
          }
  });
});

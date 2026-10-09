import { describe, expect, it } from 'vitest';
import { forestAround, isLake as lakeAt, lakeDistance, listenerPlace } from '../../src/audio/place';
import { VALLEY } from '../../src/valley/layout';
import { createValley } from '../../src/valley/valley';
import { smallValleyData } from '../fixtures/valley';

const valley = createValley(smallValleyData(513));
const isLake = lakeAt(valley, VALLEY.lake.level);
/** Metres to the lake's outline (the drawn shore). */
const outline = (x: number, z: number) => VALLEY.lake.outline.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.z - z)), Infinity);

describe('lakeDistance', () => {
  it('is 0 on the lake', () => {
    expect(lakeDistance(isLake, 150, 200)).toBe(0);
  });

  it('matches the distance to the shore within a few metres', () => {
    for (const [x, z] of [[150, 380], [-70, 240], [400, 200], [150, 20]]) {
      const d = lakeDistance(isLake, x, z);
      expect(Math.abs(d - outline(x, z)), `${x},${z}`).toBeLessThan(6);
    }
  });

  it('reports the search limit when no lake is within it', () => {
    expect(lakeDistance(isLake, -600, -600, 100)).toBe(100);
  });

  it('does not take the river upstream for the lake', () => {
    // standing on the river bend, far from the lake
    expect(lakeDistance(isLake, -330, -150, 100)).toBe(100);
  });
});

describe('forestAround', () => {
  it('is the mean forest weight of 8 points 15 m around', () => {
    const [x, z] = [-450, 520];
    let sum = 0;
    for (let k = 0; k < 8; k++) sum += valley.biomeAt(x + 15 * Math.cos((k * Math.PI) / 4), z + 15 * Math.sin((k * Math.PI) / 4)).forest;
    expect(forestAround(valley, x, z)).toBeCloseTo(sum / 8, 10);
  });

  it('is high on the forest floor and low on the lake', () => {
    expect(forestAround(valley, -450, 520)).toBeGreaterThan(0.5);
    expect(forestAround(valley, 150, 200)).toBeLessThan(0.1);
  });
});

describe('listenerPlace', () => {
  it('caches the lake distance until the camera moves 5 m', () => {
    let calls = 0;
    const counted = (x: number, z: number) => (calls++, isLake(x, z));
    const place = listenerPlace(valley, counted);
    const a = place(-70, 3, 240);
    const n = calls;
    expect(n).toBeGreaterThan(0);
    place(-68, 3, 242); // under 5 m away: cached
    expect(calls).toBe(n);
    const b = place(-70, 3, 250); // 10 m away: searched again
    expect(calls).toBeGreaterThan(n);
    expect(b.lakeDistance).toBeGreaterThan(a.lakeDistance);
  });

  it('reads the river, the height above ground and the forest', () => {
    const place = listenerPlace(valley, isLake);
    const bend = place(-180, valley.heightAt(-180, -90) + 1.8, -90); // on the river
    expect(bend.riverDistance).toBeLessThan(10);
    expect(bend.heightAboveGround).toBeGreaterThan(0);
    expect(bend.riverSlope).toBeGreaterThanOrEqual(0);
    const ridge = place(600, valley.heightAt(600, -100) + 4, -100);
    expect(ridge.riverDistance).toBeGreaterThan(300);
    expect(ridge.heightAboveGround).toBeCloseTo(4, 1);
  });
});

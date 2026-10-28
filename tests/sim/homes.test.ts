import { describe, expect, it } from 'vitest';
import { HOMES } from '../../src/sim/homes';
import { cacheKey } from '../../src/valley/key';
import { VALLEY } from '../../src/valley/layout';
import { DEFAULT_GRID, type HomeRange } from '../../src/valley/types';
import { createValley } from '../../src/valley/valley';
import { smallValleyData } from '../fixtures/valley';

const valley = createValley(smallValleyData());
const of = (species: string) => HOMES.filter((h) => h.species === species);
const overlap = (a: HomeRange, b: HomeRange) => Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) < a.radius + b.radius;
const overlapsAny = (a: HomeRange, species: string[]) => species.some((s) => of(s).some((b) => overlap(a, b)));

/** Distance (m) from (cx, cz) to the nearest water, by an outward spiral search; Infinity if none within `maxR`. */
function nearestWater(cx: number, cz: number, maxR = 400, step = 4): number {
  let theta = 0, r = 0;
  while (r <= maxR) {
    if (valley.isWater(cx + Math.cos(theta) * r, cz + Math.sin(theta) * r)) return r;
    theta += step / Math.max(r, step);
    r = (step * theta) / (Math.PI * 2);
  }
  return Infinity;
}

describe('HOMES', () => {
  it('keeps the generation cache key unchanged', () => {
    expect(cacheKey(VALLEY, DEFAULT_GRID)).toBe('baa2a988'); // recorded on main before the 4a homes
  });

  it('has about 35 to 40 natives', () => {
    const total = HOMES.reduce((s, h) => s + h.count, 0);
    expect(total).toBeGreaterThanOrEqual(35);
    expect(total).toBeLessThanOrEqual(40);
  });

  it("puts drinking water within a minute's walk of every land home", () => {
    for (const h of HOMES.filter((h) => h.medium === 'land')) {
      expect(nearestWater(h.center.x, h.center.z), h.species).toBeLessThanOrEqual(h.radius + 90);
    }
  });

  it('lets hunters reach their prey', () => {
    for (const w of of('wolf')) expect(overlapsAny(w, ['deer']), 'wolf').toBe(true);
    for (const f of of('fox')) expect(overlapsAny(f, ['rabbit', 'frog']), 'fox').toBe(true);
    for (const h of of('hawk')) expect(overlapsAny(h, ['rabbit']), 'hawk').toBe(true);
  });

  it('keeps every home inside the valley and on its medium', () => {
    for (const h of HOMES) {
      expect(valley.inside(h.center.x, h.center.z, 40), h.species).toBe(true);
      if (h.medium === 'water') expect(nearestWater(h.center.x, h.center.z), h.species).toBeLessThanOrEqual(60);
    }
  });
});

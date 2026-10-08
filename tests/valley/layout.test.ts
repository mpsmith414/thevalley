import { describe, it, expect } from 'vitest';
import { VALLEY } from '../../src/valley/layout';
import { pointInPolygon } from '../../src/valley/geom';
import type { Pt } from '../../src/valley/types';

const half = VALLEY.size / 2;
const inside = (p: Pt) => Math.abs(p.x) <= half && Math.abs(p.z) <= half;

function segsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

describe('VALLEY layout', () => {
  it('has the fixed header', () => {
    expect([VALLEY.seed, VALLEY.size, VALLEY.floor, VALLEY.rim]).toEqual([20261007, 1600, 3, 60]);
    expect(VALLEY.ridges).toHaveLength(5);
    expect(VALLEY.areas).toHaveLength(4);
    expect(VALLEY.viewpoints.map((v) => v.name)).toEqual(['Lake Shore', 'Meadow', 'Ridge Top', 'River Bend', 'Forest Floor', 'Beach', 'Rocky Knoll', 'Valley Overview']);
  });
  it('keeps ridges, areas and the river inside the world', () => {
    for (const p of [...VALLEY.ridges.flatMap((r) => r.points), ...VALLEY.areas.flatMap((a) => a.points), ...VALLEY.river.points]) expect(inside(p)).toBe(true);
  });
  it('river starts outside the lake and ends inside it', () => {
    const pts = VALLEY.river.points;
    expect(pointInPolygon(pts[0], VALLEY.lake.outline)).toBe(false);
    expect(pointInPolygon(pts[pts.length - 1], VALLEY.lake.outline)).toBe(true);
  });
  it('keeps viewpoints out of the lake', () => {
    for (const v of VALLEY.viewpoints) expect(pointInPolygon(v.pos, VALLEY.lake.outline)).toBe(false);
  });
  it('lake outline is a simple polygon', () => {
    const o = VALLEY.lake.outline, n = o.length;
    expect(n).toBe(96);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        expect(segsCross(o[i], o[(i + 1) % n], o[j], o[(j + 1) % n])).toBe(false);
      }
  });
  it('homes sum to 18 animals', () => {
    expect(VALLEY.homes.reduce((s, h) => s + h.count, 0)).toBe(18);
  });
  it('lake shore is a smooth wobbled ellipse: within 24 m of it, no sharp corners, same area', () => {
    // Control points wobble up to 8 m in x and z (11.3 m radially), the smooth radial wobble adds at most 12 m.
    const o = VALLEY.lake.outline, n = o.length;
    let maxDev = 0, maxTurn = 0, area = 0;
    for (let i = 0; i < n; i++) {
      const p = o[i], a = o[(i + n - 1) % n], b = o[(i + 1) % n], dx = p.x - 150, dz = p.z - 200;
      maxDev = Math.max(maxDev, Math.abs(Math.hypot(dx, dz) * (1 - 1 / Math.hypot(dx / 190, dz / 130))));
      let turn = Math.abs(Math.atan2(b.z - p.z, b.x - p.x) - Math.atan2(p.z - a.z, p.x - a.x));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      maxTurn = Math.max(maxTurn, (turn * 180) / Math.PI);
      area += a.x * p.z - p.x * a.z;
    }
    expect(maxDev).toBeLessThanOrEqual(24);
    expect(maxDev).toBeGreaterThan(3); // it does wobble
    expect(maxTurn).toBeLessThan(20); // a 16-gon turns 22.5 degrees at every corner
    expect(Math.abs(area / 2) / (Math.PI * 190 * 130)).toBeCloseTo(1, 1);
  });
});

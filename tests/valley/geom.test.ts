import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/util/rng';
import { pointInPolygon, sdPolygon, catmullRom, catmullRomAt, nearestOnPolyline, buildPolylineIndex, offsetPolygon } from '../../src/valley/geom';
import { VALLEY } from '../../src/valley/layout';

const square = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }];

describe('polygons', () => {
  it('pointInPolygon', () => {
    expect(pointInPolygon({ x: 0.5, z: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 2, z: 0.5 }, square)).toBe(false);
  });
  it('sdPolygon is signed (negative inside)', () => {
    expect(sdPolygon({ x: 0.5, z: 0.5 }, square)).toBeCloseTo(-0.5, 9);
    expect(sdPolygon({ x: 2, z: 0.5 }, square)).toBeCloseTo(1, 9);
  });
});

describe('catmullRom', () => {
  const ctrl = [{ x: 0, z: 0 }, { x: 50, z: 30 }, { x: 100, z: -20 }, { x: 160, z: 40 }];
  it('passes through the control points', () => {
    ctrl.forEach((c, i) => {
      const q = catmullRomAt(ctrl, i);
      expect(Math.hypot(q.x - c.x, q.z - c.z)).toBeLessThan(1e-6);
    });
    const s = catmullRom(ctrl, 0.5);
    for (const c of ctrl) expect(Math.min(...s.map((q) => Math.hypot(q.p.x - c.x, q.p.z - c.z)))).toBeLessThan(0.5);
    expect(s[0].p).toEqual(ctrl[0]);
    const last = s[s.length - 1].p;
    expect(Math.hypot(last.x - 160, last.z - 40)).toBeLessThan(1e-6 + 0.5);
  });
  it('hits control points exactly within 1e-6 of a sample when step divides evenly', () => {
    const s = catmullRom([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }], 1);
    for (const c of [0, 10, 20]) expect(Math.min(...s.map((q) => Math.abs(q.p.x - c)))).toBeLessThan(1e-6);
  });
  it('always ends exactly on the last control point', () => {
    for (const step of [0.5, 4, 7.3]) {
      const s = catmullRom(ctrl, step), last = s[s.length - 1];
      expect(last.p).toEqual(ctrl[ctrl.length - 1]);
      expect(last.s).toBeGreaterThan(s[s.length - 2].s);
      expect(Math.hypot(last.t.x, last.t.z)).toBeCloseTo(1, 6);
    }
  });
  it('catmullRomAt tolerates a single point', () => {
    expect(catmullRomAt([{ x: 3, z: 4 }], 0)).toEqual({ x: 3, z: 4 });
  });
  it('resamples to the step', () => {
    const step = 4, s = catmullRom(ctrl, step);
    for (let i = 1; i < s.length - 1; i++) {
      const d = Math.hypot(s[i].p.x - s[i - 1].p.x, s[i].p.z - s[i - 1].p.z);
      expect(d).toBeGreaterThan(step * 0.95);
      expect(d).toBeLessThan(step * 1.05);
      expect(s[i].s).toBeGreaterThan(s[i - 1].s);
    }
    for (const q of s) expect(Math.hypot(q.t.x, q.t.z)).toBeCloseTo(1, 6);
  });
});

describe('nearestOnPolyline', () => {
  it('agrees with brute force', () => {
    const samples = catmullRom([{ x: -100, z: -80 }, { x: -20, z: 40 }, { x: 60, z: -30 }, { x: 140, z: 90 }], 3);
    const idx = buildPolylineIndex(samples, 16);
    const r = mulberry32(42);
    for (let k = 0; k < 200; k++) {
      const p = { x: r() * 300 - 150, z: r() * 250 - 125 };
      let bi = 0, bd = Infinity;
      samples.forEach((q, i) => { const d = Math.hypot(q.p.x - p.x, q.p.z - p.z); if (d < bd) { bd = d; bi = i; } });
      const got = nearestOnPolyline(p, idx);
      expect(got.d).toBeCloseTo(bd, 9);
      expect(got.i).toBe(bi);
    }
  });
  it('handles an empty index', () => {
    expect(nearestOnPolyline({ x: 1, z: 2 }, buildPolylineIndex([]))).toEqual({ i: -1, d: Infinity });
  });
  it('finds samples far outside the index bounds', () => {
    const samples = catmullRom([{ x: 0, z: 0 }, { x: 40, z: 10 }], 2);
    const got = nearestOnPolyline({ x: 5000, z: -3000 }, buildPolylineIndex(samples));
    expect(got.i).toBe(samples.length - 1);
  });
});

describe('offsetPolygon', () => {
  const area = (poly: { x: number; z: number }[]) =>
    Math.abs(poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a.x * b.z - b.x * a.z; }, 0)) / 2;
  /** True when no two non-adjacent edges cross. */
  const simple = (poly: { x: number; z: number }[]) => {
    const n = poly.length, cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
    }
    return true;
  };
  type Pt = { x: number; z: number };
  const sq10 = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];

  it('grows a square by the offset on every side (either winding), keeping its corners', () => {
    for (const poly of [sq10, [...sq10].reverse()]) {
      const out = offsetPolygon(poly, 1);
      expect(out).toHaveLength(4);
      expect(Math.abs(area(out) - 144) / 144).toBeLessThan(0.01);
      expect(simple(out)).toBe(true);
      for (const p of out) expect(sdPolygon(p, poly)).toBeCloseTo(Math.SQRT2, 6); // the miter corner
    }
  });
  it('shrinks with a negative offset', () => {
    expect(Math.abs(area(offsetPolygon(sq10, -1)) - 64) / 64).toBeLessThan(0.01);
  });
  it('keeps the lake shore simple 30 m out, about 30 m from the shore everywhere', () => {
    const shore = VALLEY.lake.outline, out = offsetPolygon(shore, 30);
    expect(out).toHaveLength(shore.length);
    expect(simple(out)).toBe(true);
    for (const p of out) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
      const d = sdPolygon(p, shore);
      expect(d).toBeGreaterThan(29);
      expect(d).toBeLessThan(31.5);
    }
    expect(area(out)).toBeGreaterThan(area(shore));
  });
});

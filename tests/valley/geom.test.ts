import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/util/rng';
import { pointInPolygon, sdPolygon, catmullRom, catmullRomAt, nearestOnPolyline, buildPolylineIndex } from '../../src/valley/geom';

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
  it('resamples to the step', () => {
    const step = 4, s = catmullRom(ctrl, step);
    for (let i = 1; i < s.length; i++) {
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
});

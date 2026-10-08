import { describe, expect, it } from 'vitest';
import type { RiverSample } from '../../src/valley/generate/carve';
import { ACROSS, buildRiverMesh, flowSpeed } from '../../src/world/river';

/** A bending, falling course: samples every 2 m along a gentle arc, steeper in the middle. */
function course(n = 40): RiverSample[] {
  const out: RiverSample[] = [];
  let x = 0, z = 0, surface = 30;
  for (let k = 0; k < n; k++) {
    const a = k * 0.03, tx = Math.cos(a), tz = Math.sin(a), slope = k > 15 && k < 25 ? 0.06 : 0.004;
    if (k > 0) { x += 2 * tx; z += 2 * tz; surface -= 2 * slope; }
    out.push({ x, z, s: 2 * k, surface, width: 3 + k * 0.2, slope, tx, tz });
  }
  return out;
}

describe('buildRiverMesh', () => {
  const river = course(), m = buildRiverMesh(river), n = river.length;

  it('has five vertices across per sample, and two triangles per quad', () => {
    expect(ACROSS).toBe(5);
    expect(m.positions.length).toBe(3 * 5 * n);
    expect(m.uvs.length).toBe(2 * 5 * n);
    expect(m.attrs.length).toBe(4 * 5 * n);
    expect(m.indices.length).toBe(6 * 4 * (n - 1));
    for (const i of m.indices) expect(i).toBeLessThan(5 * n);
  });
  it('is finite everywhere', () => {
    for (const a of [m.positions, m.uvs, m.attrs, m.dirs]) for (const v of a) expect(Number.isFinite(v)).toBe(true);
  });
  it('sits 2 cm above the water surface', () => {
    for (let k = 0; k < n; k++) for (let j = 0; j < 5; j++) expect(m.positions[(k * 5 + j) * 3 + 1]).toBeCloseTo(river[k].surface + 0.02, 5);
  });
  it('runs uv.x 0–1 across and uv.y (metres along) strictly increasing downstream', () => {
    for (let k = 0; k < n; k++) for (let j = 0; j < 5; j++) {
      expect(m.uvs[(k * 5 + j) * 2]).toBeCloseTo(j / 4, 6);
      expect(m.uvs[(k * 5 + j) * 2 + 1]).toBeCloseTo(river[k].s, 6);
      if (k > 0) expect(m.uvs[(k * 5 + j) * 2 + 1]).toBeGreaterThan(m.uvs[((k - 1) * 5 + j) * 2 + 1]);
    }
  });
  it('spans the width plus 1 m, centred on the course and square to it', () => {
    for (let k = 0; k < n; k++) {
      const p = (j: number) => ({ x: m.positions[(k * 5 + j) * 3], z: m.positions[(k * 5 + j) * 3 + 2] });
      const a = p(0), b = p(4), c = p(2), r = river[k];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(r.width + 1, 5);
      expect(Math.hypot(c.x - r.x, c.z - r.z)).toBeLessThan(1e-4); // float32 positions
      expect(Math.abs((b.x - a.x) * r.tx + (b.z - a.z) * r.tz)).toBeLessThan(1e-4);
    }
  });
  it('faces up (counter-clockwise seen from above)', () => {
    const P = (i: number) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map(P);
      const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
      expect(uz * vx - ux * vz).toBeGreaterThan(0); // the normal's y component (u × v).y
    }
  });
  it('carries slope, flow speed and width per vertex', () => {
    for (let k = 0; k < n; k++) for (let j = 0; j < 5; j++) {
      const o = (k * 5 + j) * 4;
      expect(m.attrs[o]).toBeCloseTo(river[k].slope, 6);
      expect(m.attrs[o + 1]).toBeCloseTo(flowSpeed(river[k].slope), 6);
      expect(m.attrs[o + 2]).toBeCloseTo(river[k].width, 6);
      expect(m.attrs[o + 3]).toBe(0);
      expect(m.dirs[(k * 5 + j) * 2]).toBeCloseTo(river[k].tx, 6); // the way the water runs, for the ripples
      expect(m.dirs[(k * 5 + j) * 2 + 1]).toBeCloseTo(river[k].tz, 6);
    }
    expect(flowSpeed(0)).toBeCloseTo(0.4, 9);
    expect(flowSpeed(1)).toBeCloseTo(2.5, 9);
    expect(flowSpeed(0.06)).toBeGreaterThan(flowSpeed(0.004));
  });
  it('handles an empty course', () => {
    const e = buildRiverMesh([]);
    expect(e.positions.length + e.indices.length).toBe(0);
  });
});

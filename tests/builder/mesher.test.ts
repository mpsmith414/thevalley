import { describe, expect, it } from 'vitest';
import { surfaceNets } from '../../src/builder/mesher';
import { topology } from '../fixtures/mesh';
import { buildSkeleton } from '../../src/builder/skeleton';
import { bodySdf, boneSdf, roundCone, smin } from '../../src/builder/sdf';
import { v3 } from '../../src/util/vec';
import { quadruped } from '../fixtures/recipes';

describe('distance functions', () => {
  it('round cone is negative inside, ~0 on the surface, positive outside', () => {
    const a = v3(0, 0, 0), b = v3(0, 0, 1);
    expect(roundCone(v3(0, 0, 0.5), a, b, 0.2, 0.1)).toBeLessThan(0);
    expect(Math.abs(roundCone(v3(0.2, 0, 0), a, b, 0.2, 0.1))).toBeLessThan(1e-4);
    expect(Math.abs(roundCone(v3(0, 0, 1.1), a, b, 0.2, 0.1))).toBeLessThan(1e-4);
    expect(roundCone(v3(1, 0, 0.5), a, b, 0.2, 0.1)).toBeGreaterThan(0);
  });

  it('squash makes a part flat along its facing', () => {
    const ear = {
      ...buildSkeleton(quadruped).bones[0],
      start: v3(0, 0, 0), end: v3(0, 1, 0), r0: 0.1, r1: 0.1, squash: 0.2, flatFacing: 'forward' as const, pointed: false,
    };
    expect(boneSdf(v3(0, 0.5, 0.015), ear)).toBeLessThan(0); // inside, the thin way
    expect(boneSdf(v3(0, 0.5, 0.05), ear)).toBeGreaterThan(0); // 0.1 × 0.2 = 0.02 thick
    expect(boneSdf(v3(0.09, 0.5, 0), ear)).toBeLessThan(0); // still wide sideways
  });

  it('smin is min at k = 0 and never above min', () => {
    expect(smin(0.3, 0.5, 0)).toBe(0.3);
    expect(smin(0.3, 0.32, 0.1)).toBeLessThan(0.3);
  });

  it('the body is solid inside the torso and empty above it', () => {
    const sk = buildSkeleton(quadruped);
    const f = bodySdf(sk);
    const t = sk.bones[0];
    expect(f((t.start.x + t.end.x) / 2, (t.start.y + t.end.y) / 2, (t.start.z + t.end.z) / 2)).toBeLessThan(0);
    expect(f(0, t.start.y + 1, (t.start.z + t.end.z) / 2)).toBeGreaterThan(0);
  });
});

describe('surfaceNets', () => {
  const sphere = surfaceNets((x, y, z) => Math.hypot(x, y, z) - 1, v3(-1, -1, -1), v3(1, 1, 1), 0.1);

  it('makes a closed sphere of genus 0', () => {
    for (const p of sphere.positions) expect(Number.isFinite(p)).toBe(true);
    for (let i = 0; i < sphere.positions.length; i += 3)
      expect(Math.abs(Math.hypot(sphere.positions[i], sphere.positions[i + 1], sphere.positions[i + 2]) - 1)).toBeLessThan(0.05);
    const { edges, euler } = topology(sphere);
    for (const n of edges.values()) expect(n).toBe(2);
    expect(euler).toBe(2);
  });

  it('points normals and windings outward', () => {
    const p = sphere.positions, n = sphere.normals, ix = sphere.indices;
    for (let i = 0; i < p.length; i += 3) expect(p[i] * n[i] + p[i + 1] * n[i + 1] + p[i + 2] * n[i + 2]).toBeGreaterThan(0);
    let outward = 0;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (fn[0] * p[a] + fn[1] * p[a + 1] + fn[2] * p[a + 2] > 0) outward++;
    }
    expect(outward).toBe(ix.length / 3);
  });
});

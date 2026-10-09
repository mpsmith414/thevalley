import { describe, expect, it } from 'vitest';
import { createSimplifier } from '../../src/builder/simplify';
import { sampleSparse } from '../../src/builder/sparse';
import { surfaceNetsSparse } from '../../src/builder/mesher';
import { v3 } from '../../src/util/vec';

const sphere = (x: number, y: number, z: number) => Math.hypot(x, y, z) - 0.8;
const mesh = () => surfaceNetsSparse(sampleSparse(sphere, v3(-1, -1, -1), v3(1, 1, 1), 0.02));
const closed = (idx: Uint32Array) => {
  const c = new Map<string, number>();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  return [...c.values()].every((n) => n === 2);
};

describe('simplify', () => {
  it('reaches its budget, stays closed and stays on the sphere', () => {
    const m = mesh();
    const s = createSimplifier({ ...m, weight: new Float32Array(m.positions.length / 3).fill(1) });
    s.collapseTo(2000);
    const out = s.snapshot();
    expect(out.indices.length / 3).toBeLessThanOrEqual(2000);
    expect(out.indices.length / 3).toBeGreaterThan(1800);
    expect(closed(out.indices)).toBe(true);
    for (let i = 0; i < out.positions.length; i += 3)
      expect(Math.abs(Math.hypot(out.positions[i], out.positions[i + 1], out.positions[i + 2]) - 0.8)).toBeLessThan(0.02);
  });
  it('keeps more vertices where the weight is high', () => {
    const m = mesh();
    const n = m.positions.length / 3;
    const weight = new Float32Array(n).map((_, v) => (m.positions[v * 3 + 2] > 0.4 ? 8 : 1)); // the "face" cap at +z
    const s = createSimplifier({ ...m, weight });
    s.collapseTo(1500);
    const out = s.snapshot();
    let cap = 0;
    for (let i = 2; i < out.positions.length; i += 3) if (out.positions[i] > 0.4) cap++;
    const capArea = 2 * Math.PI * 0.8 * (0.8 - 0.4) / (4 * Math.PI * 0.8 * 0.8); // the cap's share of the sphere
    expect(cap / (out.positions.length / 3)).toBeGreaterThan(2 * capArea);
  });
  it('is deterministic and supports successive snapshots', () => {
    const run = () => {
      const m = mesh();
      const s = createSimplifier({ ...m, weight: new Float32Array(m.positions.length / 3).fill(1) });
      s.collapseTo(4000); const a = s.snapshot();
      s.collapseTo(1000); const b = s.snapshot();
      return [a, b];
    };
    const [a1, b1] = run(), [a2, b2] = run();
    expect(a1.positions).toEqual(a2.positions);
    expect(b1.indices).toEqual(b2.indices);
    expect(b1.indices.length).toBeLessThan(a1.indices.length);
  });
  it('leaves a non-manifold edge alone and keeps every other edge closed', () => {
    // two spheres glued along one edge: that edge has four faces
    const m = mesh();
    const n = m.positions.length / 3, t = m.indices.length;
    const u = m.indices[0], v = m.indices[1];
    const positions = new Float32Array(n * 6), indices = new Uint32Array(t * 2);
    positions.set(m.positions);
    for (let i = 0; i < n * 3; i++) positions[n * 3 + i] = m.positions[i] + (i % 3 === 0 ? 2 : 0);
    indices.set(m.indices);
    for (let i = 0; i < t; i++) {
      const x = m.indices[i];
      indices[t + i] = x === u ? u : x === v ? v : x + n;
    }
    const s = createSimplifier({ positions, indices, weight: new Float32Array(n * 2).fill(1) });
    s.collapseTo(1000);
    const out = s.snapshot();
    expect(out.indices.length / 3).toBeLessThan(6000);
    const c = new Map<string, number>();
    for (let i = 0; i < out.indices.length; i += 3) for (let e = 0; e < 3; e++) {
      const a = out.source[out.indices[i + e]], b = out.source[out.indices[i + ((e + 1) % 3)]];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    expect(c.get(u < v ? `${u},${v}` : `${v},${u}`)).toBe(4);
    expect([...c.values()].filter((k) => k !== 2)).toEqual([4]);
  });
});

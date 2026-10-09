import { describe, expect, it } from 'vitest';
import { sampleSparse } from '../../src/builder/sparse';
import { surfaceNets, surfaceNetsSparse } from '../../src/builder/mesher';
import { v3 } from '../../src/util/vec';

const sphere = (x: number, y: number, z: number) => Math.hypot(x, y, z) - 0.8;
const capsules = (x: number, y: number, z: number) =>
  Math.min(Math.hypot(x, y - Math.max(-0.5, Math.min(0.5, y)), z) - 0.2013, Math.hypot(x - 0.4, y, z) - 0.3011);

describe('sparse sampling', () => {
  it('meshes the same surface as a dense grid', () => {
    for (const f of [sphere, capsules]) {
      const dense = surfaceNets(f, v3(-1, -1, -1), v3(1, 1, 1), 0.02);
      const sparse = surfaceNetsSparse(sampleSparse(f, v3(-1, -1, -1), v3(1, 1, 1), 0.02));
      expect(sparse.positions.length).toBe(dense.positions.length);
      expect(sparse.indices.length).toBe(dense.indices.length);
    }
  });
  it('evaluates far fewer samples than a dense grid', () => {
    const s = sampleSparse(sphere, v3(-1, -1, -1), v3(1, 1, 1), 0.01);
    expect(s.evaluations).toBeLessThan(0.25 * 200 ** 3);
  });
  it('is closed: every edge has two triangles', () => {
    const m = surfaceNetsSparse(sampleSparse(capsules, v3(-1, -1, -1), v3(1, 1, 1), 0.02));
    const count = new Map<string, number>();
    for (let t = 0; t < m.indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    expect([...count.values()].every((c) => c === 2)).toBe(true);
  });
});

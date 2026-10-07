import type { MeshData } from '../../src/builder/mesher';

/** Edge use counts and the Euler characteristic of a triangle mesh. */
export function topology(m: MeshData) {
  const edges = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  return { edges, euler: m.positions.length / 3 - edges.size + m.indices.length / 3 };
}

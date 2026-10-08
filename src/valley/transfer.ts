import type { ValleyData } from './types';

/** Every distinct ArrayBuffer behind a ValleyData's typed arrays, ready to hand to `postMessage` as a transfer list. */
export function transferables(d: ValleyData): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView) => { seen.add(a.buffer as ArrayBuffer); };
  add(d.height); add(d.normals); add(d.biomes);
  add(d.water.level); add(d.water.flow); add(d.water.kind);
  for (const t of d.tiles) { add(t.plants.kind); add(t.plants.variant); add(t.plants.data); add(t.trunks); }
  for (const m of d.plantModels) for (const l of m.lods) { add(l.positions); add(l.normals); add(l.uvs); add(l.info); add(l.indices); }
  return [...seen];
}

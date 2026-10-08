import { describe, expect, it } from 'vitest';
import { VALLEY } from '../../src/valley/layout';
import { cacheKey, generateValley, type GenStage } from '../../src/valley/generate';
import { transferables } from '../../src/valley/transfer';
import { GENERATOR_VERSION, type ValleyData } from '../../src/valley/types';
import { hash, hashNumbers, stableStringify } from '../../src/util/hash';

/** One string covering every typed array (by hashNumbers) and every other field (by stableStringify). */
export function hashValley(v: unknown): string {
  if (ArrayBuffer.isView(v)) return `${v.constructor.name}:${hashNumbers(v as unknown as ArrayLike<number>)}`;
  if (Array.isArray(v)) return `[${v.map(hashValley).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${k}:${hashValley(o[k])}`).join(',')}}`;
  }
  return stableStringify(v);
}

const GRID = 257;
const stages: GenStage[] = ['shape', 'erode', 'carve', 'biomes', 'scatter', 'plants'];
const progress: [GenStage, number][] = [];
const a = generateValley(VALLEY, { grid: GRID, onProgress: (s, f) => progress.push([s, f]) });

describe('generateValley', () => {
  it('is deterministic: two runs give the same hash of every array', () => {
    const b = generateValley(VALLEY, { grid: GRID });
    expect(hash(hashValley(b))).toBe(hash(hashValley(a)));
    expect(hashValley(b)).toBe(hashValley(a));
  });

  it('fills in the whole ValleyData', () => {
    expect(a.version).toBe(GENERATOR_VERSION);
    expect(a.key).toBe(cacheKey(VALLEY, GRID));
    expect(a.grid).toBe(GRID);
    expect(a.height.length).toBe(GRID * GRID);
    expect(a.tiles.length).toBe(625);
    expect(a.plantModels.length).toBeGreaterThan(0);
    expect(a.tiles.some((t) => t.plants.kind.length > 0)).toBe(true);
  });

  it('reports all six stages in order, each from 0 to 1', () => {
    expect(progress).toEqual(stages.flatMap((s) => [[s, 0], [s, 1]]));
  });
});

describe('cacheKey', () => {
  it('changes with the layout seed, the grid and the version', () => {
    const k = cacheKey(VALLEY, 257);
    expect(cacheKey(VALLEY, 257)).toBe(k);
    expect(cacheKey({ ...VALLEY, seed: VALLEY.seed + 1 }, 257)).not.toBe(k);
    expect(cacheKey(VALLEY, 513)).not.toBe(k);
    expect(cacheKey(VALLEY, 257, GENERATOR_VERSION + 1)).not.toBe(k);
  });
});

describe('transferables', () => {
  const list = transferables(a);
  it('collects each buffer once, including terrain, water, tiles and plant meshes', () => {
    expect(new Set(list).size).toBe(list.length);
    const has = (arr: ArrayBufferView) => list.includes(arr.buffer as ArrayBuffer);
    expect(has(a.height) && has(a.normals) && has(a.biomes)).toBe(true);
    expect(has(a.water.level) && has(a.water.flow) && has(a.water.kind)).toBe(true);
    const t = a.tiles[0];
    expect(has(t.plants.kind) && has(t.plants.variant) && has(t.plants.data) && has(t.trunks)).toBe(true);
    const m = a.plantModels[0].lods[0];
    expect(has(m.positions) && has(m.normals) && has(m.uvs) && has(m.info) && has(m.indices)).toBe(true);
  });

  it('de-duplicates shared buffers', () => {
    const shared = new Float32Array(4);
    const fake = { ...a, tiles: [], plantModels: [], height: shared, normals: new Uint8Array(shared.buffer) } as ValleyData;
    expect(transferables(fake).filter((b) => b === shared.buffer).length).toBe(1);
  });
});

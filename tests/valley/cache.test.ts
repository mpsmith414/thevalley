import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { VALLEY } from '../../src/valley/layout';
import { cacheKey, generateValley, type GenStage } from '../../src/valley/generate';
import { loadCached, loadValley, saveCached } from '../../src/valley/cache';
import type { ValleyData } from '../../src/valley/types';
import { smallValleyData } from '../fixtures/valley';

const base = smallValleyData(257);
const withKey = (key: string): ValleyData => ({ ...base, key });

describe('valley cache', () => {
  it('misses when nothing is saved', async () => {
    expect(await loadCached('nope')).toBeNull();
  });

  it('round-trips typed arrays', async () => {
    const d = withKey('one');
    await saveCached(d);
    const back = await loadCached('one');
    expect(back).not.toBeNull();
    expect(back!.height).toBeInstanceOf(Float32Array);
    expect(Array.from(back!.height.subarray(0, 50))).toEqual(Array.from(d.height.subarray(0, 50)));
    expect(back!.normals).toBeInstanceOf(Uint8Array);
    expect(back!.normals.length).toBe(d.normals.length);
    expect(back!.water.mapGrid).toBe(d.water.mapGrid);
    expect(back!.water.kind).toBeInstanceOf(Uint8Array);
    expect(back!.river.length).toBe(d.river.length);
  });

  it('keeps only the newest entry', async () => {
    await saveCached(withKey('first'));
    await saveCached(withKey('second'));
    expect(await loadCached('first')).toBeNull();
    expect((await loadCached('second'))?.key).toBe('second');
  });

  it('loads as a miss, with a warning, when IndexedDB fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = globalThis.indexedDB;
    // @ts-expect-error simulate private mode
    globalThis.indexedDB = undefined;
    try {
      expect(await loadCached('x')).toBeNull();
      await expect(saveCached(withKey('x'))).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      globalThis.indexedDB = saved;
      warn.mockRestore();
    }
  });
});

describe('loadValley', () => {
  const GRID = 257;
  it('generates on a miss, saves, then serves the next call from the cache', async () => {
    const stages: GenStage[] = [];
    const gen = vi.fn(async (l: typeof VALLEY, g: number, p: (s: GenStage, f: number) => void) => generateValley(l, { grid: g, onProgress: p }));
    const first = await loadValley(VALLEY, GRID, (s) => stages.push(s), gen);
    expect(first.cached).toBe(false);
    expect(first.data.key).toBe(cacheKey(VALLEY, GRID));
    expect(gen).toHaveBeenCalledTimes(1);
    expect(stages.length).toBeGreaterThan(0);

    const second = await loadValley(VALLEY, GRID, () => {}, gen);
    expect(second.cached).toBe(true);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(second.data.key).toBe(first.data.key);
    expect(second.data.tiles.length).toBe(first.data.tiles.length);
    expect(second.data.height).toBeInstanceOf(Float32Array);
  });
});

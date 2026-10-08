import { openDB } from 'idb';
import { cacheKey, type GenStage } from './generate';
import { ValleyClient } from './client';
import type { Layout, ValleyData } from './types';

const DB = 'creature-valley', STORE = 'valleys';
const open = () => openDB(DB, 1, { upgrade(d) { d.createObjectStore(STORE, { keyPath: 'key' }); } });

/** The saved Valley with this key, or null (also null when IndexedDB is unavailable, e.g. private mode). */
export async function loadCached(key: string): Promise<ValleyData | null> {
  try {
    const db = await open();
    try { return ((await db.get(STORE, key)) as ValleyData | undefined) ?? null; } finally { db.close(); }
  } catch (e) {
    console.warn('valley cache unavailable; generating instead', e);
    return null;
  }
}

/** Save a Valley, replacing whatever was saved before (only the newest is kept). Never throws. */
export async function saveCached(data: ValleyData): Promise<void> {
  try {
    const db = await open();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      await tx.store.clear();
      await tx.store.put(data);
      await tx.done;
    } finally { db.close(); }
  } catch (e) {
    console.warn('could not save the valley cache', e);
  }
}

type Generate = (layout: Layout, grid: number, onProgress: (stage: GenStage, frac: number) => void) => Promise<ValleyData>;
const viaWorker: Generate = async (l, g, p) => {
  const client = new ValleyClient();
  try { return await client.generate(l, g, p); } finally { client.dispose(); }
};

/** The Valley for this layout and grid: from the cache if it is there, otherwise generated in the worker and then saved. */
export async function loadValley(
  layout: Layout, grid: number, onProgress: (stage: GenStage, frac: number) => void, generate: Generate = viaWorker,
): Promise<{ data: ValleyData; cached: boolean }> {
  const hit = await loadCached(cacheKey(layout, grid));
  if (hit) return { data: hit, cached: true };
  const data = await generate(layout, grid, onProgress);
  await saveCached(data);
  return { data, cached: false };
}

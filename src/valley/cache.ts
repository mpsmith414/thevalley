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
      tx.done.catch(() => {}); // a failed request also rejects `done`; the request's own error is the one we report
      await tx.store.clear();
      await Promise.all([tx.store.put(data), tx.done]);
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

/**
 * The Valley for this layout and grid: from the cache if it is there, otherwise generated in the worker.
 * A fresh Valley is saved in the background (it is returned at once); `saved` settles when that is done and never rejects.
 */
export async function loadValley(
  layout: Layout, grid: number, onProgress: (stage: GenStage, frac: number) => void, generate: Generate = viaWorker,
): Promise<{ data: ValleyData; cached: boolean; saved: Promise<void> }> {
  const hit = await loadCached(cacheKey(layout, grid));
  if (hit) return { data: hit, cached: true, saved: Promise.resolve() };
  const data = await generate(layout, grid, onProgress);
  return { data, cached: false, saved: saveCached(data) };
}

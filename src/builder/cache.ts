import { openDB } from 'idb';
import type { Recipe } from '../recipe/schema';
import { bodyKey, type BodyData } from './build';

const DB = 'creature-bodies', STORE = 'bodies', BY_TIME = 'savedAt';
/** The most bodies kept; the oldest go first. */
export const MAX_BODIES = 64;
const open = () =>
  openDB(DB, 1, { upgrade(d) { d.createObjectStore(STORE, { keyPath: 'key' }).createIndex(BY_TIME, 'savedAt'); } });

/** The key a built body is stored under: the recipe's body key plus the builder's source hash (new builder code, new keys). */
export const bodyCacheKey = (recipe: Recipe) => `${__BUILDER_HASH__}:${bodyKey(recipe)}`;

/** A saved body, or null (also null when IndexedDB is unavailable, e.g. private mode). Never throws. */
export async function loadBody(key: string): Promise<BodyData | null> {
  try {
    const db = await open();
    try { return ((await db.get(STORE, key)) as { body: BodyData } | undefined)?.body ?? null; } finally { db.close(); }
  } catch (e) {
    console.warn('body cache unavailable; building instead', e);
    return null;
  }
}

let lastSaved = 0; // strictly increasing, so saves in the same millisecond keep their order
/**
 * Save a body (a cache, not storage: failures are swallowed). Entries from another builder hash are dropped, then
 * all but the newest MAX_BODIES.
 */
export async function saveBody(key: string, body: BodyData): Promise<void> {
  try {
    const db = await open();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.done.catch(() => {}); // a failed request also rejects `done`; the request's own error is the one we report
      lastSaved = Math.max(Date.now(), lastSaved + 1);
      await tx.store.put({ key, body, savedAt: lastSaved });
      const keys = (await tx.store.index(BY_TIME).getAllKeys()) as unknown as string[]; // primary keys, oldest first
      const stale = keys.filter((k) => !k.startsWith(`${__BUILDER_HASH__}:`));
      const current = keys.filter((k) => k.startsWith(`${__BUILDER_HASH__}:`));
      const drop = [...stale, ...current.slice(0, Math.max(0, current.length - MAX_BODIES))];
      await Promise.all([...drop.map((k) => tx.store.delete(k)), tx.done]);
    } finally { db.close(); }
  } catch (e) {
    console.warn('could not save the body cache', e);
  }
}

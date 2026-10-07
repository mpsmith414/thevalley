import { openDB, type IDBPDatabase } from 'idb';
import type { CastMember } from '../cast';
import type { PassRecord } from '../designer/loop';
import type { ImageIn, KidCards } from '../designer/types';
import type { Recipe } from '../recipe/schema';

/** One saved creature: its recipe, cards, the drawing it came from and a thumbnail. */
export type GalleryItem = {
  id: string;
  recipe: Recipe;
  cards: KidCards;
  drawing: ImageIn | null;
  words: string;
  thumb: ImageIn | null;
  history: Omit<PassRecord, 'render'>[];
  createdAt: number;
  native: boolean;
};

const STORE = 'creatures';

/** The creatures saved in this browser (IndexedDB), with backup export and import. */
export class Gallery {
  private constructor(private db: IDBPDatabase) {}

  static async open(name = 'creature-lab'): Promise<Gallery> {
    const db = await openDB(name, 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { keyPath: 'id' });
      },
    });
    return new Gallery(db);
  }

  /** Made creatures newest first, then the native animals. */
  async list(): Promise<GalleryItem[]> {
    const all = (await this.db.getAll(STORE)) as GalleryItem[];
    // made creatures newest first, then the native animals in their own order
    return all.sort((a, b) => Number(a.native) - Number(b.native) || (a.native ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }

  get(id: string): Promise<GalleryItem | undefined> {
    return this.db.get(STORE, id);
  }

  async save(item: GalleryItem): Promise<void> {
    await this.db.put(STORE, item);
  }

  /** Delete a made creature (the native animals always stay). */
  async delete(id: string): Promise<boolean> {
    const item = await this.get(id);
    if (!item || item.native) return false;
    await this.db.delete(STORE, id);
    return true;
  }

  /** Put the native animals in on first run (and add any new ones later). */
  async seedNatives(cast: CastMember[]): Promise<void> {
    for (const [i, c] of cast.entries()) {
      const id = `native:${c.recipe.id}`;
      if (await this.get(id)) continue;
      await this.save({ id, recipe: c.recipe, cards: c.cards, drawing: null, words: '', thumb: null, history: [], createdAt: i, native: true });
    }
  }

  /** Every made creature as one JSON file. */
  async exportAll(): Promise<Blob> {
    const items = (await this.list()).filter((i) => !i.native);
    return new Blob([JSON.stringify({ kind: 'creature-lab-backup', version: 1, items })], { type: 'application/json' });
  }

  /** Add creatures from a backup file; ones already here are skipped. Returns how many were added. */
  async importAll(file: Blob): Promise<number> {
    const data = JSON.parse(await file.text()) as { kind?: string; items?: GalleryItem[] };
    if (data.kind !== 'creature-lab-backup' || !Array.isArray(data.items)) throw new Error('not a creature backup');
    let added = 0;
    for (const item of data.items) {
      if (!item?.id || !item.recipe || (await this.get(item.id))) continue;
      await this.save({ ...item, native: false });
      added++;
    }
    return added;
  }

  close() {
    this.db.close();
  }
}

export const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

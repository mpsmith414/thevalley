import { Gallery, type GalleryItem } from '../lab/gallery';
import type { Recipe } from '../recipe/schema';
import { fnv1a, hash } from '../util/hash';
import type { HomeRange } from '../valley/types';

/** The family's seeds: three u32s from the recipe's hash and `releasedAt` (deterministic). */
export function familySeeds(recipe: Recipe, releasedAt: number): [number, number, number] {
  const base = `${hash(recipe)}:${releasedAt}`;
  // the index goes first: FNV spreads early bytes furthest, so the three seeds are far apart
  const seed = (n: number) => parseInt(fnv1a(`${n}:${base}`), 16);
  return [seed(0), seed(1), seed(2)];
}

/** Another tab holds the creature database at an older version (close it, or reload it, to let the upgrade go on). */
export class ListBlocked extends Error {
  constructor() {
    super('the creature database is held open at an older version by another tab');
  }
}

/** The creatures that live in the valley: the gallery's items that carry a `valley` record. */
export class CreatureList {
  constructor(readonly gallery: Gallery) {}

  /**
   * Same database as the lab's gallery, so a creature released there is here. Rejects with `ListBlocked` when another
   * tab (a lab page from before version 2) holds the database at an older version: the valley must not wait on it.
   */
  static open(name?: string): Promise<CreatureList> {
    return new Promise((resolve, reject) => {
      let given = false;
      Gallery.open(name, { blocked: () => !given && ((given = true), reject(new ListBlocked())) }).then(
        (g) => (given ? g.close() : ((given = true), resolve(new CreatureList(g)))), // a late open is let go
        (e) => given || ((given = true), reject(e)),
      );
    });
  }

  private async withValley(): Promise<GalleryItem[]> {
    const items = (await this.gallery.list()).filter((i) => i.valley);
    return items.sort((a, b) => a.valley!.releasedAt - b.valley!.releasedAt);
  }

  /** Creatures living in the valley, oldest first. */
  async released(): Promise<GalleryItem[]> {
    return (await this.withValley()).filter((i) => i.valley!.status === 'released');
  }

  /** Released and exploring creatures (the exploring one is out with the camera), for the menu. */
  all(): Promise<GalleryItem[]> {
    return this.withValley();
  }

  save(item: GalleryItem): Promise<void> {
    return this.gallery.save(item);
  }

  private async mustGet(id: string): Promise<GalleryItem> {
    const item = await this.gallery.get(id);
    if (!item) throw new Error(`no creature ${id}`);
    return item;
  }

  /** Let a made creature live in the valley; the seeds are fixed the first time, so a re-release brings the same family. */
  async release(id: string, home: HomeRange | undefined, now: number): Promise<GalleryItem> {
    const item = await this.mustGet(id);
    if (item.native) throw new Error('natives live here already');
    const prev = item.valley;
    const valley = { ...prev, status: 'released' as const, seeds: prev?.seeds ?? familySeeds(item.recipe, now), releasedAt: prev?.releasedAt ?? now, ...(home ? { home } : {}) };
    const next = { ...item, valley };
    await this.gallery.save(next);
    return next;
  }

  /** Take a creature out of the valley's population while it is being explored. */
  async explore(id: string): Promise<GalleryItem> {
    const item = await this.mustGet(id);
    if (!item.valley) throw new Error(`${id} is not in the valley`);
    const next = { ...item, valley: { ...item.valley, status: 'exploring' as const } };
    await this.gallery.save(next);
    return next;
  }

  async setHome(id: string, home: HomeRange): Promise<void> {
    const item = await this.mustGet(id);
    if (!item.valley) throw new Error(`${id} is not in the valley`);
    await this.gallery.save({ ...item, valley: { ...item.valley, home } });
  }
}

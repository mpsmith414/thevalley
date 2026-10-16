import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import { CreatureList, familySeeds, ListBlocked } from '../../src/creatures/list';
import { Gallery } from '../../src/lab/gallery';
import type { GalleryItem } from '../../src/lab/gallery';
import type { HomeRange } from '../../src/valley/types';
import { quadruped, snake } from '../fixtures/recipes';

const item = (id: string, t: number, extra: Partial<GalleryItem> = {}): GalleryItem => ({
  id, recipe: quadruped, cards: CAST[0].cards, drawing: null, words: '', thumb: null, history: [], createdAt: t, native: false, ...extra,
});
const fresh = () => `list-${Math.random()}`;
const home: HomeRange = { species: 'a', count: 3, center: { x: 1, z: 2 }, radius: 10, medium: 'land', prefer: ['meadow'] };

describe('CreatureList', () => {
  it('opens a version-1 gallery database with its items unchanged', async () => {
    const name = fresh();
    const old = await openDB(name, 1, { upgrade: (d) => void d.createObjectStore('creatures', { keyPath: 'id' }) });
    await old.put('creatures', item('a', 1));
    await old.put('creatures', item('b', 2, { recipe: snake }));
    old.close();
    const list = await CreatureList.open(name);
    expect((await list.gallery.get('a'))).toMatchObject({ id: 'a', recipe: quadruped, createdAt: 1 });
    expect((await list.gallery.get('b'))?.recipe.id).toBe(snake.id);
    expect((await list.gallery.list()).filter((i) => !i.native)).toHaveLength(2);
    expect(await list.released()).toEqual([]);
  });

  it('releases a creature with its family seeds, oldest first', async () => {
    const list = await CreatureList.open(fresh());
    await list.save(item('a', 1));
    await list.save(item('b', 2));
    const b = await list.release('b', undefined, 2000);
    await list.release('a', home, 1000);
    expect(b.valley).toMatchObject({ status: 'released', releasedAt: 2000, seeds: familySeeds(quadruped, 2000) });
    expect(b.valley?.home).toBeUndefined();
    const out = await list.released();
    expect(out.map((i) => i.id)).toEqual(['a', 'b']);
    expect(out[0].valley?.home).toEqual(home);
  });

  it('explore takes a creature off the released list, release brings it back with the same seeds', async () => {
    const list = await CreatureList.open(fresh());
    await list.save(item('a', 1));
    const first = await list.release('a', undefined, 500);
    const away = await list.explore('a');
    expect(away.valley?.status).toBe('exploring');
    expect(await list.released()).toEqual([]);
    expect((await list.all()).map((i) => i.id)).toEqual(['a']);
    const back = await list.release('a', undefined, 9999);
    expect(back.valley?.seeds).toEqual(first.valley?.seeds);
    expect(back.valley?.releasedAt).toBe(500);
    expect((await list.released()).map((i) => i.id)).toEqual(['a']);
  });

  it('setHome stores the home on a released creature', async () => {
    const list = await CreatureList.open(fresh());
    await list.save(item('a', 1));
    await list.release('a', undefined, 1);
    await list.setHome('a', home);
    expect((await list.released())[0].valley?.home).toEqual(home);
  });

  it('never releases a native, or a creature that is not there', async () => {
    const list = await CreatureList.open(fresh());
    await list.gallery.seedNatives(CAST);
    await expect(list.release(`native:${CAST[0].recipe.id}`, undefined, 1)).rejects.toThrow('natives live here already');
    await expect(list.release('nope', undefined, 1)).rejects.toThrow();
    expect(await list.all()).toEqual([]);
  });
});

describe('familySeeds', () => {
  it('is deterministic, three u32s, and differs with the time or the recipe', () => {
    const a = familySeeds(quadruped, 1000);
    expect(familySeeds(quadruped, 1000)).toEqual(a);
    expect(a).toHaveLength(3);
    for (const s of a) expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
    expect(new Set(a).size).toBe(3);
    expect(familySeeds(quadruped, 1001)).not.toEqual(a);
    expect(familySeeds(snake, 1000)).not.toEqual(a);
  });
});

describe('CreatureList.open with another tab on an older version (final review I4)', () => {
  it('does not wait on a version-1 connection that never lets go: it rejects (the valley opens with its natives)', async () => {
    const name = fresh();
    const old = await openDB(name, 1, { upgrade: (d) => void d.createObjectStore('creatures', { keyPath: 'id' }) }); // no versionchange handler
    await expect(CreatureList.open(name)).rejects.toBeInstanceOf(ListBlocked);
    old.close(); // the old tab closes: the late open goes through and is let go, so a later open works
    const list = await CreatureList.open(name);
    expect(await list.released()).toEqual([]);
  });

  it('a gallery lets go when a newer version wants the database, so it never blocks an upgrade itself', async () => {
    const name = fresh();
    const g = await Gallery.open(name);
    const blocked: string[] = [];
    const next = await openDB(name, 3, { blocked: () => void blocked.push('blocked') });
    expect(blocked).toEqual([]);
    expect(next.version).toBe(3);
    next.close();
    await expect(g.list()).rejects.toThrow(); // this one has let go
  });

  it('the lab hears of a blocked open, and its open goes on once the old tab has gone', async () => {
    const name = fresh();
    const old = await openDB(name, 1, { upgrade: (d) => void d.createObjectStore('creatures', { keyPath: 'id' }) });
    let told = 0;
    const opening = Gallery.open(name, { blocked: () => void told++ });
    await new Promise((r) => setTimeout(r, 20));
    expect(told).toBe(1);
    old.close();
    const g = await opening;
    expect(await g.list()).toEqual([]);
  });
});

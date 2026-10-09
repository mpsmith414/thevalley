import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import { nextFocus, type Rect } from '../../src/shared/focus';
import { Gallery, type GalleryItem } from '../../src/lab/gallery';
import { EMPTY_PAD, Input, edges, readPad } from '../../src/shared/input';
import { quadruped } from '../fixtures/recipes';

describe('readPad', () => {
  const pad = (axes: number[], pressed: number[] = []) => ({ axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })) });

  it('ignores small stick drift and maps buttons', () => {
    const s = readPad(pad([0.1, -0.05, 0.9, 0], [0, 12]));
    expect(s.lx).toBe(0);
    expect(s.ly).toBe(0);
    expect(s.rx).toBeGreaterThan(0.8);
    expect(s.a).toBe(true);
    expect(s.up).toBe(true);
    expect(s.b).toBe(false);
    expect(readPad(null)).toEqual(EMPTY_PAD);
  });

  it('reports only newly pressed buttons', () => {
    const a = readPad(pad([0, 0, 0, 0], [0]));
    const b = readPad(pad([0, 0, 0, 0], [0, 1]));
    expect(edges(a, b)).toEqual(['b']);
    expect(edges(b, b)).toEqual([]);
  });
});

describe('Input.mouse', () => {
  it('returns zero when nothing moved', () => {
    const input = new Input(new EventTarget());
    expect(input.mouse()).toEqual({ dx: 0, dy: 0 });
    expect(input.pad()).toEqual(EMPTY_PAD);
    expect(input.held('W')).toBe(false);
  });
});

describe('nextFocus', () => {
  // a 3 × 2 grid of buttons
  const grid: Rect[] = [0, 1, 2].flatMap((c) => [0, 1].map((r) => ({ id: `${r}${c}`, x: c * 100, y: r * 60, w: 80, h: 40 })));

  it('moves to the neighbour in the pressed direction', () => {
    expect(nextFocus(grid, '00', 'right')).toBe('01');
    expect(nextFocus(grid, '00', 'down')).toBe('10');
    expect(nextFocus(grid, '12', 'up')).toBe('02');
    expect(nextFocus(grid, '11', 'left')).toBe('10');
  });

  it('stays put when nothing lies that way', () => {
    expect(nextFocus(grid, '00', 'left')).toBe('00');
    expect(nextFocus(grid, '00', 'up')).toBe('00');
  });
});

describe('Gallery', () => {
  const item = (id: string, t: number): GalleryItem => ({
    id, recipe: quadruped, cards: CAST[0].cards, drawing: { base64: 'eA==', mediaType: 'image/jpeg' }, words: 'hi', thumb: null, history: [], createdAt: t, native: false,
  });

  it('saves, lists newest first, and keeps natives', async () => {
    const g = await Gallery.open(`test-${Math.random()}`);
    await g.seedNatives(CAST);
    await g.save(item('a', 10));
    await g.save(item('b', 20));
    const list = await g.list();
    expect(list.slice(0, 2).map((i) => i.id)).toEqual(['b', 'a']);
    expect(list.filter((i) => i.native).map((i) => i.recipe.id)).toEqual(CAST.map((c) => c.recipe.id));
    expect(await g.delete(`native:${CAST[0].recipe.id}`)).toBe(false);
    expect(await g.delete('a')).toBe(true);
    expect((await g.list()).some((i) => i.id === 'a')).toBe(false);
  });

  it('round-trips a backup into an empty gallery', async () => {
    const g = await Gallery.open(`test-${Math.random()}`);
    await g.save(item('a', 10));
    await g.save(item('b', 20));
    const backup = await g.exportAll();
    const fresh = await Gallery.open(`test-${Math.random()}`);
    expect(await fresh.importAll(backup)).toBe(2);
    expect(await fresh.importAll(backup)).toBe(0); // already there
    expect((await fresh.get('a'))?.drawing).toEqual({ base64: 'eA==', mediaType: 'image/jpeg' });
  });

  it('upgrades an old recipe when it is read back', async () => {
    const g = await Gallery.open(`test-${Math.random()}`);
    const v1 = structuredClone(quadruped) as unknown as Record<string, unknown>;
    delete v1.build; delete v1.face; v1.schemaVersion = 1;
    await g.save({ ...item('old', 5), recipe: v1 as unknown as GalleryItem['recipe'] });
    const got = await g.get('old');
    expect(got?.recipe.schemaVersion).toBe(2);
    expect(got?.recipe.build.feet).toBe('paws');
    expect((await g.list()).find((i) => i.id === 'old')?.recipe.face.nose).toBe('pad');
  });

  it('refreshes a stored native whose recipe changed, keeping its createdAt', async () => {
    const g = await Gallery.open(`test-${Math.random()}`);
    const id = `native:${CAST[0].recipe.id}`;
    await g.save({ ...item(id, 3), recipe: quadruped, native: true });
    await g.seedNatives(CAST);
    const got = await g.get(id);
    expect(got?.recipe).toEqual(CAST[0].recipe);
    expect(got?.createdAt).toBe(3);
  });
});

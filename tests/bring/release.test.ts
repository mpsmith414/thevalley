import 'fake-indexeddb/auto';
import { Group, type Object3D } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { arrivalShot, type ArrivalShot } from '../../src/bring/arrival';
import { comeBack, keepMade, placeHomeless, releaseMade, sendExploring, visit, type ReleaseDeps } from '../../src/bring/release';
import type { Made } from '../../src/bring/workshop';
import type { BodyData } from '../../src/builder/build';
import { CAST } from '../../src/cast';
import { CreatureList, familySeeds } from '../../src/creatures/list';
import type { ImageIn } from '../../src/designer/types';
import type { GalleryItem } from '../../src/lab/gallery';
import type { Family } from '../../src/residents/residents';
import { VALLEY } from '../../src/valley/layout';
import type { Viewpoint } from '../../src/valley/types';
import { createValley } from '../../src/valley/valley';
import { quadruped } from '../fixtures/recipes';
import { smallValleyData } from '../fixtures/valley';

const valley = createValley(smallValleyData(513));
const m = VALLEY.areas.find((a) => a.kind === 'meadow')!.points;
const meadow = { x: m.reduce((s, p) => s + p.x, 0) / m.length, z: m.reduce((s, p) => s + p.z, 0) / m.length };
const eye = { x: meadow.x, y: valley.heightAt(meadow.x, meadow.z) + 1.6, z: meadow.z }, forward = { x: 0, z: 1 };
const img: ImageIn = { base64: 'AAAA', mediaType: 'image/png' };
const thumb: ImageIn = { base64: 'BBBB', mediaType: 'image/png' };
const made: Made = {
  token: 't1', maker: { name: 'Mia', badge: '🦊' }, input: { image: img, words: 'a stripy fox' }, recipe: quadruped,
  body: {} as BodyData, cards: CAST[0].cards, history: [{ pass: 1, render: img, verdict: 'edits', note: 'Bigger ears', edits: 2 }], thumb,
};
const later = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };

type Member = { rig: { position: { x: number; z: number }; altitude: number }; home: Family['valley']['home']; out: boolean };

/** Fakes for everything but the list (fake-indexeddb) and the valley (the small generated one). */
async function setup(opts: { fail?: boolean; glide?: Promise<void> } = {}) {
  const list = await CreatureList.open(`release-${Math.random()}`);
  const log: string[] = [];
  const added: { item: Family; entry?: { x: number; z: number }[]; onward?: { x: number; z: number }[] }[] = [];
  const glides: Viewpoint[] = [], shots: ArrivalShot[] = [], holds: [string, string][] = [], compiled: Object3D[] = [], removed: string[] = [];
  const families = new Map<string, Member[]>();
  let ids = 0, placed = false;
  const residents = {
    async addSpecies(item: Family, o: { compile: (root: Object3D) => Promise<void>; entry?: { x: number; z: number }[]; onward?: { x: number; z: number }[] }) {
      log.push('add');
      added.push({ item, entry: o.entry, onward: o.onward });
      if (opts.fail) throw new Error('the body would not build');
      await o.compile(new Group());
      placed = true;
      families.set(item.id, [0, 1, 2].map((k) => ({ rig: { position: { x: item.valley.home.center.x + k, z: item.valley.home.center.z }, altitude: 0 }, home: item.valley.home, out: false })));
    },
    async removeSpecies(id: string) {
      log.push('remove');
      removed.push(id);
      families.delete(id);
    },
    familyOf: (id: string) => families.get(id) ?? [],
    leaving: (a: Member) => a.out,
  };
  const deps: ReleaseDeps = {
    list, valley, residents: residents as unknown as ReleaseDeps['residents'],
    camera: () => ({ eye, forward }),
    glideTo: (v) => (log.push('glide'), glides.push(v), opts.glide ?? Promise.resolve()),
    arriveAt: (id, shot) => (log.push(`arrive ${id}`), shots.push(shot), opts.glide ?? Promise.resolve()),
    hold: (id, title) => void (log.push('hold'), holds.push([id, title])),
    cancel: (id) => void log.push(`cancel ${id}`),
    compile: async (root) => void (log.push('compile'), compiled.push(root)),
    warm: () => void log.push('warm'),
    now: () => 5000,
    newId: () => `c${++ids}`,
  };
  return { list, deps, log, added, glides, shots, holds, compiled, removed, families, placed: () => placed };
}

describe('releaseMade', () => {
  it('saves the creature with its valley record and home, glides there, brings the family in from 3 entry points, then holds with its title', async () => {
    const s = await setup();
    const item = await releaseMade(made, s.deps);
    expect(s.log).toEqual(['arrive c1', 'add', 'compile', 'warm', 'hold']);
    const saved = (await s.list.gallery.get('c1'))!;
    expect(item).toEqual(saved);
    expect(saved).toMatchObject({
      id: 'c1', recipe: quadruped, cards: made.cards, drawing: img, words: 'a stripy fox', thumb, createdAt: 5000, native: false,
      maker: { name: 'Mia', badge: '🦊' }, history: [{ pass: 1, verdict: 'edits', note: 'Bigger ears', edits: 2 }],
    });
    expect(saved.history[0]).not.toHaveProperty('render'); // the look-again pictures are not kept
    expect(saved.valley).toMatchObject({ status: 'released', seeds: familySeeds(quadruped, 5000), releasedAt: 5000 });
    const home = saved.valley!.home!;
    expect(home).toMatchObject({ species: 'c1', count: 3, medium: 'land' });
    expect((home.center.x - eye.x) * forward.x + (home.center.z - eye.z) * forward.z).toBeGreaterThan(0); // in front of the camera
    expect(s.shots).toEqual([arrivalShot(valley, home, eye, quadruped.life.sizeM)]);
    expect(s.glides).toEqual([]);
    expect(s.added).toHaveLength(1);
    expect(s.added[0].item).toEqual(saved);
    expect(s.added[0].entry).toHaveLength(3);
    for (const p of s.added[0].entry!) expect(Math.hypot(p.x - home.center.x, p.z - home.center.z)).toBeGreaterThan(6); // outside the creature-sized wide framing (10.5 m back here)
    expect(s.added[0].onward).toHaveLength(3); // then on together into the valley
    expect(s.holds).toEqual([['c1', `${made.cards.name} has come to the valley!`]]);
    expect((await s.list.released()).map((i) => i.id)).toEqual(['c1']);
  });

  it('keeps the family out of the valley until the camera has arrived', async () => {
    const glide = later();
    const s = await setup({ glide: glide.promise });
    const done = releaseMade(made, s.deps);
    await settle();
    expect(s.compiled).toHaveLength(1); // compiling while the camera flies
    expect(s.placed()).toBe(false);
    expect(s.log).not.toContain('hold');
    glide.resolve();
    await done;
    expect(s.placed()).toBe(true);
    expect(s.log.slice(-2)).toEqual(['warm', 'hold']);
  });

  it('a body that will not come into the valley leaves the creature kept (no valley record), and says so', async () => {
    const s = await setup({ fail: true });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const item = await releaseMade(made, s.deps);
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
    expect(item.valley).toBeUndefined();
    const saved = (await s.list.gallery.get('c1'))!;
    expect(saved.valley).toBeUndefined();
    expect(saved).toMatchObject({ id: 'c1', recipe: quadruped, maker: made.maker, thumb });
    expect(await s.list.all()).toEqual([]);
    expect(s.log).not.toContain('hold');
    expect(s.log).not.toContain('warm'); // nothing was added
    expect(s.log.at(-1), 'the arrival is called off: the camera and the next turn go free (Review Focus 5)').toBe('cancel c1');
    expect(s.holds).toEqual([]);
  });
});

describe('keepMade', () => {
  it('saves the creature for the lab, with no valley record', async () => {
    const s = await setup();
    const item = await keepMade(made, s.deps);
    expect(item).toEqual(await s.list.gallery.get('c1'));
    expect(item).toMatchObject({ id: 'c1', recipe: quadruped, cards: made.cards, drawing: img, words: 'a stripy fox', thumb, maker: made.maker, native: false });
    expect(item.valley).toBeUndefined();
    expect(await s.list.all()).toEqual([]);
  });
});

describe('Off exploring and Come back', () => {
  it('sendExploring marks it exploring and walks the family out', async () => {
    const s = await setup();
    await releaseMade(made, s.deps);
    await sendExploring('c1', s.deps);
    expect((await s.list.gallery.get('c1'))!.valley!.status).toBe('exploring');
    expect(s.removed).toEqual(['c1']);
    expect(await s.list.released()).toEqual([]);
    expect((await s.list.all()).map((i) => i.id)).toEqual(['c1']); // still in the list
  });

  it('comeBack releases it again into its saved home, with the arrival', async () => {
    const s = await setup();
    const first = await releaseMade(made, s.deps);
    await sendExploring('c1', s.deps);
    s.log.length = 0;
    s.shots.length = 0;
    s.holds.length = 0;
    await comeBack('c1', s.deps);
    const back = (await s.list.gallery.get('c1'))!;
    expect(back.valley).toEqual({ ...first.valley, status: 'released' }); // same home, seeds and release time
    expect(s.log).toEqual(['arrive c1', 'add', 'compile', 'warm', 'hold']);
    expect(s.shots).toEqual([arrivalShot(valley, first.valley!.home!, eye, quadruped.life.sizeM)]);
    expect(s.holds).toEqual([['c1', `${made.cards.name} is back!`]]);
    expect(s.added.at(-1)!.item.valley.home).toEqual(first.valley!.home);
    expect(s.added.at(-1)!.entry).toHaveLength(3);
  });

  it('a come back that fails leaves it exploring', async () => {
    const s = await setup();
    await releaseMade(made, s.deps);
    await sendExploring('c1', s.deps);
    const failing = await setup({ fail: true });
    await expect(comeBack('c1', { ...failing.deps, list: s.list })).rejects.toThrow('would not build');
    expect(failing.log).toEqual(['arrive c1', 'add', 'cancel c1']);
    expect((await s.list.gallery.get('c1'))!.valley!.status).toBe('exploring');
  });
});

describe('visit', () => {
  it('glides to the family when it is in the valley', async () => {
    const s = await setup();
    const item = await releaseMade(made, s.deps);
    s.glides.length = 0;
    expect(visit('c1', s.deps)).toBe(true);
    expect(s.glides).toHaveLength(1);
    const c = item.valley!.home!.center, v = s.glides[0];
    expect(Math.hypot(v.look.x - (c.x + 1), v.look.z - c.z)).toBeLessThan(1e-6); // looking at the middle of the three
  });

  it('frames a flier family up where it soars, from further back (not the meadow under it)', async () => {
    const s = await setup();
    const item = await releaseMade(made, s.deps);
    s.families.get('c1')!.forEach((a) => (a.rig.altitude = 36));
    s.glides.length = 0;
    expect(visit('c1', s.deps)).toBe(true);
    const v = s.glides[0], c = item.valley!.home!.center;
    expect(v.look).toEqual({ x: c.x + 1, z: c.z, h: 36 });
    expect(v.pos.h).toBeGreaterThanOrEqual(36);
    expect(Math.hypot(v.pos.x - v.look.x, v.pos.z - v.look.z)).toBeCloseTo(35, 5);
  });

  it('is false (and stays put) when the family is not in the valley, or is walking out', async () => {
    const s = await setup();
    expect(visit('nobody', s.deps)).toBe(false);
    await releaseMade(made, s.deps);
    s.families.get('c1')!.forEach((a) => (a.out = true));
    s.glides.length = 0;
    expect(visit('c1', s.deps)).toBe(false);
    expect(s.glides).toEqual([]);
  });
});

describe('placeHomeless', () => {
  it('gives every released creature without a home (released in the lab) a home in front of the eye, and saves it', async () => {
    const s = await setup();
    const base = (id: string, extra: Partial<GalleryItem> = {}): GalleryItem => ({
      id, recipe: quadruped, cards: made.cards, drawing: null, words: '', thumb: null, history: [], createdAt: 1, native: false, ...extra,
    });
    await s.list.save(base('a'));
    await s.list.save(base('b'));
    await s.list.release('a', undefined, 10);
    await s.list.release('b', undefined, 20);
    const placed = await releaseMade(made, s.deps); // has its home already
    const out = await placeHomeless(await s.list.released(), s.deps);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c1']);
    for (const i of out) {
      const home = i.valley!.home!;
      expect(home.species).toBe(i.id);
      expect((home.center.x - eye.x) * forward.x + (home.center.z - eye.z) * forward.z).toBeGreaterThan(0);
      expect((await s.list.gallery.get(i.id))!.valley!.home).toEqual(home); // saved
    }
    expect(out[2]).toEqual(placed); // one with a home is left as it was
    expect(out[0].valley!.seeds).toEqual(familySeeds(quadruped, 10));
  });
});

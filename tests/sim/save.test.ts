import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { CAST } from '../../src/cast';
import { CreatureList } from '../../src/creatures/list';
import type { GalleryItem } from '../../src/lab/gallery';
import { SAVE_VERSION, ValleySaves, backupName, makeBackup, reconcile, restoreBackup, type SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, type SpeciesDef } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { nativeDefs } from '../fixtures/sim';
import { quadruped, snake } from '../fixtures/recipes';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const natives = nativeDefs();
const rabbit = natives.find((d) => d.id === 'rabbit')!;
/** A released family of three, as the gallery gives it (the rabbit's recipe, a home of its own). */
const family: SpeciesDef = { ...rabbit, id: 'gallery-1', name: 'Spotty Longlegs', released: true, target: 3, seeds: [11, 22, 33],
  home: { ...rabbit.home, species: 'gallery-1', center: { x: -100, z: 150 }, radius: 40 } };
const fresh = () => `saves-${Math.random()}`;
/** An animal-time step that is not a whole number of ticks, so a save falls mid-tick. */
const DT = 0.37;

/** A save of `sim` at `hours` (the speed and the time of saving are made up). */
const fileOf = (sim: Sim, hours: number): SaveFile =>
  ({ kind: 'valley-save', version: SAVE_VERSION, savedAt: 1234, clock: { hours, speed: 1 / 15, paused: true }, sim: sim.state() });

/** Steps `sim` through `hours` valley hours of animal time in steps of DT, from `from`; returns the clock at the end. */
function live(sim: Sim, from: number, hours: number): number {
  let h = from;
  for (let i = 0, n = Math.round((hours * ANIMAL_S_PER_HOUR) / DT); i < n; i++) sim.step(DT, (h += DT / ANIMAL_S_PER_HOUR));
  return h;
}

describe('ValleySaves', () => {
  it('has no save to begin with, keeps one, and forgets it', async () => {
    const saves = await ValleySaves.open(fresh());
    expect(await saves.load()).toBeNull();
    const sim = new Sim(world, { seed: 3, species: natives });
    const f = fileOf(sim, 9.25);
    await saves.save(f);
    expect(await saves.load()).toEqual(f);
    await saves.clear();
    expect(await saves.load()).toBeNull();
    saves.close();
  });

  it('round-trips a save, and a second open of the same database finds it', async () => {
    const name = fresh();
    const sim = new Sim(world, { seed: 3, species: [...natives, family] });
    live(sim, START_HOUR, 0.05);
    const f = fileOf(sim, START_HOUR + 0.05);
    const a = await ValleySaves.open(name);
    await a.save(f);
    a.close();
    const b = await ValleySaves.open(name);
    expect(await b.load()).toEqual(f);
    b.close();
  });

  it('sets aside a save it cannot read, with a warning, and carries on without one', async () => {
    const sim = new Sim(world, { seed: 3, species: natives });
    const good = fileOf(sim, 7);
    const { sim: _sim, ...noSim } = good;
    const bad: unknown[] = [{ ...good, version: 99 }, noSim, 'not a save at all', { ...good, clock: { ...good.clock, speed: 0 } },
      { ...good, sim: { ...good.sim, agents: 'many' } }, { ...good, sim: { ...good.sim, acc: undefined } }, { ...good, kind: 'something-else' }];
    for (const raw of bad) {
      const name = fresh();
      const db = await openDB(name, 1, { upgrade: (d) => void d.createObjectStore('save') });
      await db.put('save', raw, 'current');
      db.close();
      const saves = await ValleySaves.open(name);
      const warn = console.warn;
      let warned = 0;
      console.warn = () => void warned++;
      try {
        expect(await saves.load()).toBeNull();
      } finally {
        console.warn = warn;
      }
      expect(warned).toBe(1);
      saves.close();
      const check = await openDB(name);
      expect(await check.get('save', 'set-aside')).toEqual(raw);
      expect(await check.get('save', 'current')).toBeUndefined();
      check.close();
      const again = await ValleySaves.open(name);
      expect(await again.load()).toBeNull(); // nothing is left to warn about
      await again.save(good);
      expect(await again.load()).toEqual(good);
      again.close();
    }
  });
});

describe('a restored valley', () => {
  it('carries on exactly as the original (through the database, mid-tick)', { timeout: 120_000 }, async () => {
    const defs = [...natives, family], a = new Sim(world, { seed: 7, species: defs });
    const h = live(a, START_HOUR, 2);
    expect(a.state().acc).toBeGreaterThan(0); // saved between ticks
    const saves = await ValleySaves.open(fresh());
    await saves.save(fileOf(a, h));
    const saved = (await saves.load())!;
    saves.close();
    const b = new Sim(world, { seed: 7, species: defs, state: reconcile(saved.sim, defs, world) });
    expect(b.state()).toEqual(a.state());
    live(a, h, 1);
    live(b, saved.clock.hours, 1);
    expect(b.state()).toEqual(a.state());
  });
});

describe('reconcile', () => {
  it('drops the animals of a species that is not in the list, with what points at them', () => {
    const defs = [...natives, family], sim = new Sim(world, { seed: 7, species: defs });
    live(sim, START_HOUR, 0.02);
    const st = sim.state();
    st.pending.push({ species: 'gallery-1', at: 5 }, { species: 'deer', at: 6 });
    st.governor.chase = 'gallery-1#0';
    const out = reconcile(st, natives, world);
    expect(out.agents.some((x) => x.species === 'gallery-1')).toBe(false);
    expect(out.agents).toHaveLength(st.agents.filter((x) => x.species !== 'gallery-1').length);
    expect(out.pending).toEqual([{ species: 'deer', at: 6 }]);
    expect(out.nextN['gallery-1']).toBeUndefined();
    expect(out.governor.chase).toBeNull();
    expect(st.agents.some((x) => x.species === 'gallery-1')).toBe(true); // the saved state itself is left as it was
    expect(() => new Sim(world, { seed: 7, species: natives, state: out })).not.toThrow();
  });

  it('adds three animals at spots in the home of a released family with none, numbered from 0', () => {
    const before = new Sim(world, { seed: 7, species: natives }).state();
    const out = reconcile(before, [...natives, family], world);
    const added = out.agents.filter((x) => x.species === 'gallery-1');
    expect(added.map((x) => x.id)).toEqual(['gallery-1#0', 'gallery-1#1', 'gallery-1#2']);
    expect(added.map((x) => x.seed)).toEqual([11, 22, 33]);
    for (const x of added) expect(Math.hypot(x.motion.x - family.home.center.x, x.motion.z - family.home.center.z)).toBeLessThanOrEqual(family.home.radius);
    expect(out.nextN['gallery-1']).toBe(3);
    expect(out.agents.slice(0, before.agents.length)).toEqual(before.agents); // the others are as they were
    const sim = new Sim(world, { seed: 7, species: [...natives, family], state: out });
    expect(sim.agents.filter((x) => x.species === 'gallery-1')).toHaveLength(3);
    expect(new Set(sim.agents.map((x) => x.id)).size).toBe(sim.agents.length);
  });

  it('does not refill a family that has newcomers on the way, and keeps numbers above every kept animal', () => {
    const defs = [...natives, family], st = new Sim(world, { seed: 7, species: defs }).state();
    st.agents = st.agents.filter((x) => x.id !== 'gallery-1#0' && x.id !== 'gallery-1#1'); // two gone, one newcomer due
    st.pending.push({ species: 'gallery-1', at: 100 });
    st.nextN['gallery-1'] = 1; // behind the kept #2 (a hand-damaged save)
    const out = reconcile(st, defs, world);
    expect(out.agents.filter((x) => x.species === 'gallery-1').map((x) => x.id)).toEqual(['gallery-1#2']);
    expect(out.nextN['gallery-1']).toBe(3);
    for (const d of natives) expect(out.nextN[d.id]).toBeGreaterThan(Math.max(...out.agents.filter((x) => x.species === d.id).map((x) => x.n)));
  });

  it('leaves a native that has no animals to the newcomers', () => {
    const st = new Sim(world, { seed: 7, species: natives }).state();
    st.agents = st.agents.filter((x) => x.species !== 'rabbit');
    expect(reconcile(st, natives, world).agents.some((x) => x.species === 'rabbit')).toBe(false);
  });
});

describe('the valley backup', () => {
  /** A made creature with pictures (base64), a maker and a valley record, as a phone-made one is stored. */
  const made = (id: string, t: number, over: Partial<GalleryItem> = {}): GalleryItem => ({
    id, recipe: quadruped, cards: CAST[0].cards, drawing: { base64: 'AAEC/w==', mediaType: 'image/png' }, words: 'a spotty one',
    thumb: { base64: '/9j/4AAQ', mediaType: 'image/jpeg' }, history: [{ pass: 1, verdict: 'edits', note: 'longer ears', edits: 2 }],
    createdAt: t, native: false, maker: { name: 'Ada', badge: '🦊' },
    valley: { status: 'released', seeds: [1, 2, 3], releasedAt: t * 10, home: { species: id, count: 3, center: { x: 1, z: 2 }, radius: 10, medium: 'land', prefer: ['meadow'] } }, ...over,
  });
  const stores = async () => ({ saves: await ValleySaves.open(fresh()), list: await CreatureList.open(fresh()) });
  const parse = async (b: Blob) => JSON.parse(await b.text());

  it('restores a saved valley and two released creatures into empty stores exactly (a mid-tick save carries on the same)', { timeout: 120_000 }, async () => {
    const from = await stores(), defs = [...natives, family], sim = new Sim(world, { seed: 7, species: defs });
    const h = live(sim, START_HOUR, 1);
    expect(sim.state().acc).toBeGreaterThan(0);
    const f = fileOf(sim, h);
    await from.saves.save(f);
    const a = made('a', 1), b = made('b', 2, { recipe: snake, valley: { status: 'exploring', seeds: [4, 5, 6], releasedAt: 30 } });
    await from.list.save(a);
    await from.list.save(b);
    await from.list.save(made('plain', 3, { valley: undefined })); // made, never released: not part of the valley
    const file = await makeBackup(from.saves, from.list);
    expect(file.type).toBe('application/json');
    expect((await parse(file)).items.map((i: GalleryItem) => i.id).sort()).toEqual(['a', 'b']);

    const to = await stores();
    expect(await restoreBackup(file, to.saves, to.list)).toEqual({ added: 2 });
    expect(await to.saves.load()).toEqual(f);
    expect(await to.list.gallery.get('a')).toEqual(a);
    expect(await to.list.gallery.get('b')).toEqual(b);
    expect(await to.list.gallery.get('plain')).toBeUndefined();
    expect((await to.list.released()).map((i) => i.id)).toEqual(['a']);
    const loaded = (await to.saves.load())!, carried = new Sim(world, { seed: 7, species: defs, state: reconcile(loaded.sim, defs, world) });
    live(sim, h, 0.5);
    live(carried, loaded.clock.hours, 0.5);
    expect(carried.state()).toEqual(sim.state());
  });

  it('is plain JSON all through: a gallery item has no Blob or typed array to lose', async () => {
    const { saves, list } = await stores();
    const a = made('a', 1);
    await list.save(a);
    expect(JSON.parse(JSON.stringify(await list.gallery.get('a')))).toEqual(a);
    expect((await parse(await makeBackup(saves, list))).save).toBeNull();
  });

  it('throws on a wrong kind, a bad file or an unreadable save, and changes nothing', async () => {
    const { saves, list } = await stores(), good = fileOf(new Sim(world, { seed: 3, species: natives }), 8);
    await saves.save(good);
    const blob = (v: unknown) => new Blob([typeof v === 'string' ? v : JSON.stringify(v)]);
    const items = [made('a', 1)];
    for (const bad of [{ kind: 'creature-lab-backup', version: 1, items }, { kind: 'valley-backup', version: 2, save: null, items },
      { kind: 'valley-backup', version: 1, save: null }, { kind: 'valley-backup', version: 1, save: { ...good, version: 9 }, items },
      { kind: 'valley-backup', version: 1, items }, 'not json {', [1, 2]]) {
      await expect(restoreBackup(blob(bad), saves, list)).rejects.toThrow('not a valley backup');
    }
    expect(await saves.load()).toEqual(good);
    expect(await list.gallery.get('a')).toBeUndefined();
  });

  it('keeps a creature already in the gallery as it is, adds the other, and the save replaces the current one', async () => {
    const from = await stores(), s1 = fileOf(new Sim(world, { seed: 3, species: natives }), 8);
    await from.saves.save(s1);
    await from.list.save(made('a', 1));
    await from.list.save(made('b', 2));
    const file = await makeBackup(from.saves, from.list);
    const to = await stores();
    const mine = made('a', 1, { words: 'mine, changed since' });
    await to.list.save(mine);
    await to.saves.save({ ...s1, clock: { ...s1.clock, hours: 20 } });
    expect(await restoreBackup(file, to.saves, to.list)).toEqual({ added: 1 });
    expect(await to.list.gallery.get('a')).toEqual(mine);
    expect((await to.list.gallery.get('b'))?.id).toBe('b');
    expect(await to.saves.load()).toEqual(s1);
  });

  it('a backup of a valley with no save clears the current save', async () => {
    const from = await stores(), to = await stores();
    await from.list.save(made('a', 1));
    const file = await makeBackup(from.saves, from.list);
    await to.saves.save(fileOf(new Sim(world, { seed: 3, species: natives }), 8));
    expect(await restoreBackup(file, to.saves, to.list)).toEqual({ added: 1 });
    expect(await to.saves.load()).toBeNull();
  });

  it('names the file by the local date', () => {
    expect(backupName(new Date(2026, 9, 5, 23, 59))).toBe('valley-backup-2026-10-05.json');
    expect(backupName(new Date(2026, 0, 31))).toBe('valley-backup-2026-01-31.json');
  });
});

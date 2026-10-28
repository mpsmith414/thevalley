import { describe, expect, it } from 'vitest';
import { RETRY, emptiestHome, placeName, shortOf } from '../../src/sim/behaviours/arrive';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Agent, type SpeciesDef } from '../../src/sim/types';
import { fnv1a } from '../../src/util/hash';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const defs = nativeDefs();
const rabbit = defs.find((d) => d.id === 'rabbit')!;
/** A released family of three, as the gallery gives it (the rabbit's recipe and home). */
const family: SpeciesDef = { ...rabbit, id: 'gallery-1', name: 'Spotty Longlegs', released: true, target: 3, seeds: [11, 22, 33] };
/** The test's view: the camera 150 m east of the rabbits' home, seeing only a disc of this radius round its centre. */
const SEEN = 60, eye = { x: rabbit.home.center.x + 150, z: rabbit.home.center.z };
const inDisc = (p: { x: number; z: number }) => Math.hypot(p.x - rabbit.home.center.x, p.z - rabbit.home.center.z) < SEEN;
const view = { eye, seen: () => false, seenAt: inDisc };
const MEADOW = defs.filter((d) => d.id === 'rabbit' || d.id === 'deer');

/** Rabbits and deer only (no hunters, so nothing is caught but what a test takes), seeing only the disc. */
const meadow = (seed = 5, extra: SpeciesDef[] = []) => {
  const sim = new Sim(world, { seed, species: [...MEADOW, ...extra] });
  sim.setView(view);
  return sim;
};
const rabbits = (sim: Sim) => sim.agents.filter((a) => a.species === 'rabbit' && a.doing !== 'returning');
const away = (a: Agent) => Math.hypot(a.motion.x - rabbit.home.center.x, a.motion.z - rabbit.home.center.z);

/** A clock for `sim`: `run` takes it `hours` valley hours on in steps of four ticks (`k` counts them), `each` after every step. */
function clock(sim: Sim, k0 = 0) {
  let k = k0;
  return {
    sim,
    get k() {
      return k;
    },
    run(hours: number, each?: () => void) {
      for (let i = 0, n = Math.round((hours * ANIMAL_S_PER_HOUR) / (4 * TICK)); i < n; i++) {
        sim.step(4 * TICK, START_HOUR + (++k * 4 * TICK) / ANIMAL_S_PER_HOUR);
        each?.();
      }
    },
  };
}

/** As if caught: it goes back to the earth (and is then removed). */
const catchIt = (sim: Sim, a: Agent) => sim.ctx.become(a, 'returning');

describe('newcomers', () => {
  it('refills a species from the edge, out of view, and walks them in', () => {
    const sim = meadow();
    const { run } = clock(sim);
    expect(rabbits(sim)).toHaveLength(8);
    catchIt(sim, sim.get('rabbit#1')!);
    catchIt(sim, sim.get('rabbit#4')!);
    const entered: { id: string; x: number; z: number; doing: string; route: number }[] = [], arrivedAt = new Map<string, number>();
    const text: string[] = [];
    sim.moments.on((m) => m.kind === 'newcomer' && text.push(m.text));
    const was = new Map<string, string>();
    sim.drain();
    const track = () => {
      for (const e of sim.drain()) {
        const a = e.type === 'added' ? sim.get(e.id)! : null;
        if (a) entered.push({ id: a.id, x: a.motion.x, z: a.motion.z, doing: a.doing, route: a.route.length });
      }
      for (const a of sim.agents) {
        if (was.get(a.id) === 'arrive' && a.doing !== 'arrive') arrivedAt.set(a.id, away(a));
        was.set(a.id, a.doing);
      }
    };
    run(5, track);
    expect(rabbits(sim)).toHaveLength(8);
    expect(entered.map((e) => e.id)).toEqual(['rabbit#8', 'rabbit#9']);
    for (const e of entered) {
      expect(inDisc(e), `${e.id} entered out of view`).toBe(false);
      expect(Math.max(Math.abs(e.x), Math.abs(e.z))).toBeGreaterThan(world.size / 2 - 25); // at the valley's edge
      expect(e.doing).toBe('arrive');
      expect(e.route).toBe(0); // a newcomer has no onward point
    }
    run(3, track); // and they walk in to the middle of their home, then live there
    expect([...arrivedAt.keys()].sort()).toEqual(['rabbit#8', 'rabbit#9']);
    for (const d of arrivedAt.values()) expect(d).toBeLessThanOrEqual(rabbit.home.radius);
    expect(text).toEqual(['A new rabbit has come to the meadow.', 'A new rabbit has come to the meadow.']);
    const moment = sim.moments.recent().find((m) => m.kind === 'newcomer')!;
    expect(moment.species).toEqual(['rabbit']);
    expect(moment.interest).toBe(0.5);
  });

  it('makes up a caught animal once, 2 to 4 valley hours on', () => {
    const sim = meadow();
    const { run } = clock(sim);
    run(0.5);
    expect(sim.state().pending).toEqual([]);
    catchIt(sim, sim.get('rabbit#3')!);
    run(0.1);
    expect(sim.state().pending).toHaveLength(1);
    const gone = sim.state().t;
    run(0.3);
    expect(sim.state().pending).toHaveLength(1);
    const due = (sim.state().pending[0].at - gone) / ANIMAL_S_PER_HOUR;
    expect(due).toBeGreaterThan(1.9);
    expect(due).toBeLessThan(4.1);
  });

  it('brings a whole released family back, as the next looks, the same every time', () => {
    const go = () => {
      const sim = meadow(5, []);
      sim.addSpecies(family);
      const { run } = clock(sim);
      run(0.01);
      for (const a of sim.agents.filter((x) => x.species === 'gallery-1')) catchIt(sim, a);
      const text: string[] = [];
      sim.moments.on((m) => m.kind === 'newcomer' && text.push(m.text));
      run(6);
      return { sim, text };
    };
    const { sim, text } = go();
    const back = sim.agents.filter((a) => a.species === 'gallery-1');
    expect(back.map((a) => [a.id, a.n]).sort()).toEqual([['gallery-1#3', 3], ['gallery-1#4', 4], ['gallery-1#5', 5]]);
    for (const a of back) expect(a.seed).toBe(parseInt(fnv1a(`${a.n}:gallery-1`), 16));
    expect(text).toEqual(Array(3).fill('A new Spotty Longlegs has come to the meadow.'));
    expect(go().sim.state()).toEqual(sim.state());
  });

  it('puts a newcomer into the home that is shortest', () => {
    const sim = new Sim(world, { seed: 5, species: defs.filter((d) => d.id === 'fox') });
    expect(sim.agents.map((a) => a.home)).toEqual([0, 0, 1, 1]);
    catchIt(sim, sim.get('fox#2')!); // the second home's
    clock(sim).run(5);
    const foxes = sim.agents.filter((a) => a.species === 'fox');
    expect(foxes.map((a) => a.id).sort()).toEqual(['fox#0', 'fox#1', 'fox#3', 'fox#4']);
    expect(foxes.find((a) => a.n === 4)?.home).toBe(1);
  });

  it('waits and tries again soon while the entry point is seen, and comes when it is not', () => {
    const sim = meadow();
    sim.setView({ ...view, seenAt: () => true }); // the whole valley is in view
    const { run } = clock(sim);
    catchIt(sim, sim.get('rabbit#2')!);
    run(6);
    expect(rabbits(sim)).toHaveLength(7);
    const [p] = sim.state().pending;
    expect(p.at).toBeGreaterThan(sim.state().t); // put off again and again
    expect(p.at - sim.state().t).toBeLessThanOrEqual(RETRY + 1e-9);
    sim.setView(view);
    run((RETRY + 1) / ANIMAL_S_PER_HOUR);
    expect(rabbits(sim)).toHaveLength(8);
    expect(sim.state().pending).toEqual([]);
  });

  it('comes in with nothing seen when no view is set', () => {
    const sim = new Sim(world, { seed: 5, species: defs.filter((d) => d.id === 'rabbit') });
    catchIt(sim, sim.get('rabbit#0')!);
    clock(sim).run(5);
    expect(rabbits(sim)).toHaveLength(8);
  });

  it('comes in from a spot in the home when no way in from the edge will do (a trout), out of view', () => {
    const trout = defs.find((d) => d.id === 'trout')!, c = trout.home.center;
    const sim = new Sim(world, { seed: 5, species: [trout] });
    sim.setView({ eye: { x: c.x + 300, z: c.z }, seen: () => false, seenAt: (p) => Math.hypot(p.x - c.x, p.z - c.z) > trout.home.radius * 0.5 }); // sees all but the middle
    catchIt(sim, sim.get('trout#0')!);
    sim.drain();
    const entered: { x: number; z: number }[] = [];
    clock(sim).run(5, () => sim.drain().forEach((e) => e.type === 'added' && entered.push({ ...sim.get(e.id)!.motion })));
    expect(entered).toHaveLength(1);
    expect(Math.hypot(entered[0].x - c.x, entered[0].z - c.z)).toBeLessThan(trout.home.radius * 0.5);
    expect(world.isWater(entered[0].x, entered[0].z)).toBe(true);
  });

  it('keeps its state through JSON: a pending newcomer, and one walking in', () => {
    const a = meadow(6), ca = clock(a);
    catchIt(a, a.get('rabbit#5')!);
    ca.run(0.5);
    expect(a.state().pending).toHaveLength(1);
    const restore = (s: Sim, k: number) => {
      const b = new Sim(world, { seed: 6, species: MEADOW, state: JSON.parse(JSON.stringify(s.state())) });
      b.setView(view);
      return clock(b, k);
    };
    const cb = restore(a, ca.k);
    expect(cb.sim.state()).toEqual(a.state());
    // on to a newcomer that is walking in, and a third copy made then
    let cc: ReturnType<typeof restore> | null = null;
    for (let i = 0; i < 6 * ANIMAL_S_PER_HOUR && !cc; i++) {
      ca.run(1 / ANIMAL_S_PER_HOUR);
      cb.run(1 / ANIMAL_S_PER_HOUR);
      if (a.get('rabbit#8')?.doing === 'arrive') cc = restore(a, ca.k);
    }
    expect(cc, 'a newcomer walked in').not.toBeNull();
    const walking = a.get('rabbit#8')!;
    expect(walking.place).not.toBeNull();
    expect(cc!.sim.get('rabbit#8')!.place).toEqual(walking.place);
    for (let i = 0; i < 150; i++) for (const c of [ca, cb, cc!]) c.run(1 / ANIMAL_S_PER_HOUR);
    expect(a.get('rabbit#8')!.doing).not.toBe('arrive'); // it has walked in
    expect(cb.sim.state()).toEqual(a.state());
    expect(cc!.sim.state()).toEqual(a.state());
  });
});

describe('a restored pending newcomer', () => {
  it('is dropped when its species has no def, without a throw', () => {
    const a = meadow(6);
    clock(a).run(0.1);
    const state = JSON.parse(JSON.stringify(a.state()));
    state.pending.push({ species: 'gone', at: state.t + 1 }, { species: 'rabbit', at: state.t + 1e6 });
    const b = new Sim(world, { seed: 6, species: MEADOW, state });
    expect(b.state().pending.map((p) => p.species)).toEqual(['rabbit']);
    expect(() => clock(b, Math.round(state.t / (4 * TICK))).run(0.1)).not.toThrow(); // well past the dropped entry's due time
    expect(b.state().pending.map((p) => p.species)).toEqual(['rabbit']);
  });
});

describe('arrive helpers', () => {
  const animal = (species: string, doing = 'graze', home = 0) => ({ species, doing, home } as Agent);

  it('counts what a species is short of, by its homes and what is already coming', () => {
    const two = defs.filter((d) => d.id === 'fox'); // 2 + 2
    const four = [animal('fox'), animal('fox'), animal('fox'), animal('fox')];
    expect(shortOf(two, four, [])).toEqual([]);
    expect(shortOf(two, [...four.slice(1), animal('fox', 'returning')], [])).toEqual([{ species: 'fox', n: 1 }]);
    expect(shortOf(two, four.slice(1), [{ species: 'fox' }])).toEqual([]);
    expect(shortOf(two, four.slice(2), [{ species: 'fox' }])).toEqual([{ species: 'fox', n: 1 }]);
  });

  it('picks the home with the biggest gap, the first on a tie', () => {
    const two = defs.filter((d) => d.id === 'fox');
    expect(emptiestHome(two, [animal('fox'), animal('fox'), animal('fox', 'graze', 1), animal('fox', 'graze', 1)], 'fox')).toBe(two[0]);
    expect(emptiestHome(two, [animal('fox'), animal('fox'), animal('fox', 'graze', 1)], 'fox')).toBe(two[1]);
    expect(emptiestHome(two, [animal('fox'), animal('fox', 'graze', 1), animal('fox', 'returning', 1), animal('fox', 'graze', 1)], 'fox')).toBe(two[0]);
  });

  it('names where a home is', () => {
    const name = (species: string, k = 0) => placeName(world, defs.filter((d) => d.id === species)[k].home);
    expect([name('rabbit'), name('deer'), name('wolf'), name('fox'), name('duck'), name('frog'), name('trout', 1)]).toEqual(['meadow', 'meadow', 'forest', 'forest', 'lake', 'lake', 'river']);
  });
});

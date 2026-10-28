import { describe, expect, it } from 'vitest';
import { GIVE_UP, ARRIVED, ARRIVE_LOW, ARRIVE_MS, ARRIVE_NEAR, ARRIVE_SPEED, LEAVE_DIST, LEAVE_GAP, LEAVE_SPEED, LEAVE_TIME, ON_ARRIVED, ON_START } from '../../src/sim/behaviours/arrive';
import { soarHeight } from '../../src/sim/behaviours/feed';
import { Sim } from '../../src/sim/sim';
import { traitsFor } from '../../src/sim/traits';
import { ANIMAL_S_PER_HOUR, TICK, type Agent, type Pt, type SpeciesDef } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const defs = nativeDefs();
const native = (id: string) => defs.find((d) => d.id === id)!;
/** A released family of three with a native's recipe and home (the release gives it a home of its own). */
const released = (id: string, from: string): SpeciesDef => ({ ...native(from), id, name: 'Spotty Longlegs', released: true, target: 3, seeds: [11, 22, 33] });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

/** A clock for `sim`: runs it `seconds` animal seconds a tick at a time from the start of the morning, `each` after every tick. */
function clock(sim: Sim) {
  let k = 0;
  return (seconds: number, each?: () => void) => {
    for (let i = 0, n = Math.round(seconds / TICK); i < n; i++) {
      sim.step(TICK, START_HOUR + (++k * TICK) / ANIMAL_S_PER_HOUR);
      each?.();
    }
  };
}

/** Three points `r` m from `c` side by side (3 m apart) on the first bearing (every 30°, from `from`) where all are dry and the way to `c` is clear. */
function line(sim: Sim, def: SpeciesDef, r: number, from = 0): Pt[] {
  const c = def.home.center, t = traitsFor(def.recipe, def.home.medium);
  for (let k = 0; k < 12; k++) {
    const a = from + (k * Math.PI) / 6, ux = Math.cos(a), uz = Math.sin(a);
    const pts = [0, 1, 2].map((i) => ({ x: c.x + ux * r - uz * (i - 1) * 3, z: c.z + uz * r + ux * (i - 1) * 3 }));
    if (pts.every((p) => !world.isWater(p.x, p.z) && sim.ctx.places.open(t, p, c.x, c.z))) return pts;
  }
  throw new Error('no clear line');
}

describe('arrive', () => {
  it('walks a family in from its entry points, on together to its onward points, then lets it live', () => {
    const def = released('c-q', 'rabbit'), sim = new Sim(world, { seed: 3, species: [] });
    const entry = line(sim, native('rabbit'), 25), onward = line(sim, native('rabbit'), 30, Math.PI);
    const c = def.home.center;
    const family = sim.addSpecies(def, { entry, onward });
    const t = sim.traits('c-q');
    expect(sim.drain().map((e) => e.type)).toEqual(['added', 'added', 'added']);
    const spot = onward.map((o) => ({ x: c.x + (o.x - c.x) * ON_START, z: c.z + (o.z - c.z) * ON_START }));
    family.forEach((a, k) => {
      expect([a.motion.x, a.motion.z]).toEqual([entry[k].x, entry[k].z]); // each at its own entry point
      expect(a.doing).toBe('arrive');
      expect(a.place).toEqual(spot[k]); // first to near the middle of the home, on its way to the onward point
      expect(a.route).toEqual([onward[k]]); // the onward leg waits in the route
    });
    const run = clock(sim), first = [false, false, false], walkedOn = [false, false, false], reached = [false, false, false];
    let fast = 0;
    run(1);
    for (const a of family) fast = Math.max(fast, a.motion.speed);
    expect(fast).toBeGreaterThan(Math.min(t.topSpeed, ARRIVE_MS) * 0.9); // briskly: about 2.5 m/s at least
    run(59, () => {
      family.forEach((a, k) => {
        if (a.doing === 'arrive' && a.route.length === 0) walkedOn[k] = true; // the second leg
        if (a.doing === 'arrive' && a.route.length === 1 && dist(a.motion, spot[k]) < ON_ARRIVED) first[k] = true;
        if (dist(a.motion, onward[k]) < ON_ARRIVED + 0.5) reached[k] = true;
      });
    });
    expect(first).toEqual([true, true, true]);
    expect(walkedOn).toEqual([true, true, true]);
    expect(reached).toEqual([true, true, true]);
    for (const a of family) {
      expect(a.doing, `${a.id} chose freely`).not.toBe('arrive');
      expect(a.place).not.toEqual(onward[family.indexOf(a)]);
    }
  });

  it('is told as one high moment, by the kid card name', () => {
    const sim = new Sim(world, { seed: 3, species: [] });
    const entry = line(sim, native('rabbit'), 25);
    sim.addSpecies(released('c-q', 'rabbit'), { entry });
    const moments = sim.moments.recent();
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ kind: 'arrive', interest: 0.8, text: 'Spotty Longlegs and family have arrived in the valley.', species: ['c-q'] });
    const quiet = new Sim(world, { seed: 3, species: [] });
    quiet.addSpecies(released('c-q', 'rabbit')); // a reload: no walk-in, nothing to tell
    expect(quiet.moments.recent()).toEqual([]);
    expect(quiet.agents.every((a) => a.doing !== 'arrive')).toBe(true);
  });

  it('with no onward point walks in to near the middle of its home, then chooses freely', () => {
    const def = released('c-q', 'deer'), sim = new Sim(world, { seed: 4, species: [] });
    const entry = line(sim, native('deer'), 50);
    const family = sim.addSpecies(def, { entry }), c = def.home.center;
    const spots = family.map((a) => a.place!), ends: { at: number; spot: Pt; from: Pt }[] = [];
    family.forEach((a) => expect(a.route).toEqual([]));
    let was = family.map(() => 'arrive');
    clock(sim)(60, () => {
      family.forEach((a, k) => {
        if (was[k] === 'arrive' && a.doing !== 'arrive') ends.push({ at: k, spot: spots[k], from: { x: a.motion.x, z: a.motion.z } });
        was[k] = a.doing;
      });
    });
    expect(ends).toHaveLength(3);
    for (const e of ends) expect(Math.min(dist(e.from, e.spot), dist(e.from, c) / (ARRIVE_NEAR * def.home.radius) * ARRIVED)).toBeLessThanOrEqual(ARRIVED + 1); // at its spot, or that near the middle
    for (const s of spots) expect(dist(s, c)).toBeLessThanOrEqual(def.home.radius);
  });

  it('walks at about 2.5 m/s, never below half its top speed, and flat out if it is slower than that', () => {
    const slow = released('c-f', 'frog'), sim = new Sim(world, { seed: 4, species: [] });
    const frog = sim.addSpecies(slow, { entry: line(sim, native('frog'), 25) });
    const quick = released('c-d', 'deer'), s2 = new Sim(world, { seed: 4, species: [] });
    const deer = s2.addSpecies(quick, { entry: line(s2, native('deer'), 50) });
    clock(sim)(1);
    clock(s2)(1);
    const top = (s: Sim, id: string) => s.traits(id).topSpeed;
    expect(frog[0].motion.speedFrac).toBe(Math.min(1, Math.max(ARRIVE_SPEED, ARRIVE_MS / top(sim, 'c-f'))));
    expect(frog[0].motion.speedFrac * top(sim, 'c-f')).toBeCloseTo(ARRIVE_MS, 0); // about 2.5 m/s
    expect(deer[0].motion.speedFrac).toBe(ARRIVE_SPEED); // a quick walker still only half out
    expect(top(s2, 'c-d')).toBeGreaterThan(ARRIVE_MS / ARRIVE_SPEED);
  });

  it('brings a flier in low, and up to its own height on arrival', () => {
    const def = released('c-h', 'hawk'), sim = new Sim(world, { seed: 5, species: [] }), c = def.home.center;
    const entry = [0, 1, 2].map((i) => ({ x: c.x + 60, z: c.z + i * 3 })), family = sim.addSpecies(def, { entry });
    let high = 0;
    const done: { flying: boolean; cruise: number | null; altitude: number; soar: number }[] = [];
    const was = family.map(() => 'arrive');
    clock(sim)(60, () => {
      family.forEach((a, k) => {
        if (a.doing === 'arrive' && a.motion.cruise === ARRIVE_LOW) high = Math.max(high, a.motion.altitude); // (not on the tick it is done and starts to climb)
        if (was[k] === 'arrive' && a.doing !== 'arrive') done.push({ flying: a.motion.flying, cruise: a.motion.cruise, altitude: a.motion.altitude, soar: soarHeight(a) });
        was[k] = a.doing;
      });
    });
    expect(high).toBeGreaterThan(ARRIVE_LOW - 0.5); // low, not on the ground
    expect(high).toBeLessThanOrEqual(ARRIVE_LOW + 0.01);
    expect(done).toHaveLength(3);
    for (const d of done) {
      expect(d.flying).toBe(true);
      expect(d.cruise).toBe(d.soar); // 28 to 45 m: on up to its own height
      expect(d.soar).toBeGreaterThan(ARRIVE_LOW + 20);
      expect(d.altitude).toBeLessThan(ARRIVE_LOW + 1);
    }
  });

  it('breaks off its walk when afraid, and lives from where it stands', () => {
    const sim = new Sim(world, { seed: 3, species: [] }), entry = line(sim, native('rabbit'), 25);
    const family = sim.addSpecies(released('c-q', 'rabbit'), { entry, onward: line(sim, native('rabbit'), 30, Math.PI) });
    clock(sim)(2);
    expect(family[0].doing).toBe('arrive');
    sim.setNeeds(family[0].id, { fear: 0.9 });
    clock(sim)(0.2);
    expect(family[0].doing).not.toBe('arrive');
    expect(family[0].route).toEqual([]);
    expect(family[1].doing).toBe('arrive'); // the others carry on
  });

  it('does not count a newcomer on its way in as part of its group', () => {
    const sim = new Sim(world, { seed: 5, species: defs.filter((d) => d.id === 'rabbit') }), run = clock(sim);
    sim.setView({ eye: { x: 0, z: 0 }, seen: () => false });
    sim.ctx.become(sim.get('rabbit#0')!, 'returning');
    let n = 0;
    run(4 * ANIMAL_S_PER_HOUR, () => {
      const walker = sim.agents.find((a) => a.doing === 'arrive');
      if (!walker || ++n % 50) return;
      const mine = sim.agents.filter((a) => a !== walker && a.group === walker.group && a.doing !== 'arrive');
      const a = mine.find((x) => x.doing !== 'returning')!, others = mine.filter((x) => x !== a);
      const centre = sim.ctx.centre(a)!;
      expect(centre.x).toBeCloseTo(others.reduce((s, b) => s + sim.prev(b.id)!.x, 0) / others.length, 6);
      expect(centre.z).toBeCloseTo(others.reduce((s, b) => s + sim.prev(b.id)!.z, 0) / others.length, 6);
    });
    expect(n).toBeGreaterThan(50); // the newcomer was walking for a while
  });
});

describe('arrive (fix round 1)', () => {
  it('gives up a walk that never gets anywhere after GIVE_UP, and chooses freely', { timeout: 30_000 }, () => {
    const sim = new Sim(world, { seed: 3, species: [] }), entry = line(sim, native('rabbit'), 25);
    const [a] = sim.addSpecies(released('c-q', 'rabbit'), { entry });
    a.place = { x: 20000, z: 20000 }; // a spot no walker reaches
    const run = clock(sim);
    run(GIVE_UP - 5);
    expect(a.doing).toBe('arrive');
    run(10);
    expect(a.doing).not.toBe('arrive');
    expect(a.route).toEqual([]);
  });
});

describe('leave', () => {
  const eye = { x: native('rabbit').home.center.x + 150, z: native('rabbit').home.center.z };

  it('walks a family away from the eye and removes it after LEAVE_TIME when it stays in view', () => {
    const def = released('c-q', 'rabbit'), sim = new Sim(world, { seed: 3, species: [] }), c = def.home.center;
    const family = sim.addSpecies(def);
    sim.setView({ eye, seen: () => true }); // always in view
    const run = clock(sim);
    run(1);
    sim.drain();
    const start = family.map((a) => dist(a.motion, eye));
    sim.removeSpecies('c-q');
    family.forEach((a, k) => {
      expect(a.doing).toBe('leave');
      const to = a.route[0], side = (k - 1) * LEAVE_GAP;
      expect(dist(to, c)).toBeCloseTo(Math.hypot(LEAVE_DIST, side), 6); // 80 m out, side by side 4 m apart
      expect((to.x - c.x) * (c.x - eye.x) + (to.z - c.z) * (c.z - eye.z)).toBeGreaterThan(0); // away from the eye
      expect(a.until).toBeCloseTo(sim.state().t + LEAVE_TIME, 6);
    });
    const events: { at: number; ids: string[] }[] = [];
    let t = 0;
    run(LEAVE_TIME + 1, () => {
      t += TICK;
      const ev = sim.drain();
      if (ev.length) events.push({ at: t, ids: ev.map((e) => (e.type === 'removed' ? e.id : '?')) });
      for (const a of family) if (sim.get(a.id)) expect(a.doing, `${a.id} leaving`).toBe('leave');
    });
    expect(events).toHaveLength(1); // all three together
    expect(events[0].ids.sort()).toEqual(['c-q#0', 'c-q#1', 'c-q#2']);
    expect(events[0].at).toBeGreaterThan(LEAVE_TIME - 0.3);
    expect(events[0].at).toBeLessThanOrEqual(LEAVE_TIME + 0.3);
    family.forEach((a, k) => expect(dist(a.motion, eye), `${a.id} walked away`).toBeGreaterThan(start[k] + 20));
    expect(sim.agents).toEqual([]);
    expect(sim.traits('c-q')).toBeUndefined(); // the valley has let go of the species
  });

  it('is removed as soon as none of it is seen', () => {
    const def = released('c-q', 'rabbit'), sim = new Sim(world, { seed: 3, species: [] }), c = def.home.center;
    const family = sim.addSpecies(def);
    const out = (id: string) => dist(sim.get(id)!.motion, c) < 40; // seen while within 40 m of its home's middle
    sim.setView({ eye, seen: out });
    const run = clock(sim);
    run(1);
    sim.drain();
    sim.removeSpecies('c-q');
    let at = -1, t = 0;
    run(LEAVE_TIME, () => {
      t += TICK;
      if (at < 0 && sim.drain().length) at = t;
    });
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(LEAVE_TIME - 2); // well before the time was up
    expect(family.every((a) => !sim.get(a.id))).toBe(true);
  });

  it('is removed at once, from where it stands, with nothing seen (no view)', () => {
    const sim = new Sim(world, { seed: 3, species: [] });
    sim.addSpecies(released('c-q', 'rabbit'));
    sim.drain();
    sim.removeSpecies('c-q');
    sim.step(TICK, START_HOUR);
    expect(sim.drain().map((e) => e.type)).toEqual(['removed', 'removed', 'removed']);
  });

  it('keeps walking when afraid (it is going anyway, only faster)', () => {
    const sim = new Sim(world, { seed: 3, species: [] }), family = sim.addSpecies(released('c-q', 'rabbit'));
    sim.setView({ eye, seen: () => true });
    sim.removeSpecies('c-q');
    const run = clock(sim);
    run(1);
    expect(family[0].motion.speedFrac).toBe(LEAVE_SPEED);
    sim.setNeeds(family[0].id, { fear: 0.9 });
    run(0.5);
    expect(family[0].doing).toBe('leave');
    expect(family[0].motion.speedFrac).toBeGreaterThan(LEAVE_SPEED);
  });

  it('takes the hawk out in the air, and leaves a caught one to go back to the earth', () => {
    const sim = new Sim(world, { seed: 3, species: [] }), family = sim.addSpecies(released('c-h', 'hawk'));
    sim.setView({ eye, seen: () => true });
    const run = clock(sim);
    sim.ctx.become(family[2], 'returning');
    sim.removeSpecies('c-h');
    expect(family.map((a) => a.doing)).toEqual(['leave', 'leave', 'returning']);
    run(5);
    expect(family[0].motion.flying).toBe(true);
    expect(family[0].motion.wantFly).toBe(true);
    run(LEAVE_TIME);
    expect(sim.agents).toEqual([]);
  });

  it('cannot be hunted while it walks out', () => {
    const sim = new Sim(world, { seed: 3, species: [native('fox'), native('rabbit')] });
    const fox = sim.get('fox#0')!, rabbit = sim.get('rabbit#0')!, t = sim.traits('fox');
    expect(sim.ctx.huntable(fox, t, rabbit)).toBe(true);
    sim.ctx.become(rabbit, 'leave');
    expect(sim.ctx.huntable(fox, t, rabbit)).toBe(false);
  });

  it('may be re-added while a caught member is still sinking (no id used twice)', () => {
    const def = released('c-q', 'rabbit'), sim = new Sim(world, { seed: 3, species: [] });
    const [first] = sim.addSpecies(def);
    sim.setView({ eye, seen: () => true });
    const run = clock(sim);
    run(1);
    sim.ctx.become(first, 'returning'); // just caught
    sim.removeSpecies('c-q');
    const again = sim.addSpecies(def);
    expect(() => run(10)).not.toThrow();
    expect(sim.agents).toEqual(again);
    expect(new Set(sim.agents.map((a) => a.id)).size).toBe(3);
    for (const a of again) expect(sim.get(a.id)).toBe(a);
    expect(sim.prev('c-q#0')).toBeDefined();
  });

  it('lets a species that comes back replace one still walking out', () => {
    const def = released('c-q', 'rabbit'), sim = new Sim(world, { seed: 3, species: [] });
    sim.addSpecies(def);
    sim.setView({ eye, seen: () => true });
    clock(sim)(1);
    sim.drain();
    sim.removeSpecies('c-q');
    const again: Agent[] = sim.addSpecies(def);
    expect(sim.drain().map((e) => `${e.type} ${e.id}`)).toEqual([
      'removed c-q#0', 'removed c-q#1', 'removed c-q#2', 'added c-q#0', 'added c-q#1', 'added c-q#2',
    ]);
    expect(sim.agents).toEqual(again);
    expect(again.every((a) => a.doing !== 'leave')).toBe(true);
    sim.removeSpecies('nobody'); // nothing to remove
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Doing, type MomentKind, type SimWorld } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const make = (seed = 7) => new Sim(world, { seed, species: nativeDefs() });
/** One valley day of animal seconds. */
const DAY = 24 * ANIMAL_S_PER_HOUR;
const HUNTERS = ['fox', 'wolf', 'hawk'];

/** Steps `sim` through `seconds` of animal time in steps of `dt`, the clock keeping pace; `each` runs after every step. */
function run(sim: Sim, seconds: number, dt: number, each?: () => void) {
  let hours = START_HOUR;
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) {
    hours += dt / ANIMAL_S_PER_HOUR;
    sim.step(dt, hours);
    each?.();
  }
}

describe('Sim', () => {
  it('places every native in the valley', () => {
    const sim = make();
    expect(sim.agents.length).toBe(nativeDefs().reduce((s, d) => s + d.target, 0));
    expect(new Set(sim.agents.map((a) => a.id)).size).toBe(sim.agents.length);
    expect(sim.get('deer#0')?.species).toBe('deer');
    expect(sim.drain()).toEqual([]); // the starting animals are not news
  });

  it('is deterministic', { timeout: 60_000 }, () => {
    const a = make(7), b = make(7);
    run(a, DAY, 16 * TICK);
    run(b, DAY, 16 * TICK);
    expect(a.state()).toEqual(b.state());
    expect(a.moments.recent()).toEqual(b.moments.recent());
    expect(a.moments.recent().length).toBeGreaterThan(0);
  });

  it('does nothing at dt 0', () => {
    const sim = make();
    sim.step(1, START_HOUR);
    const before = sim.state(), alpha = sim.alpha;
    sim.step(0, START_HOUR);
    expect(sim.state()).toEqual(before);
    expect(sim.alpha).toBe(alpha);
  });

  it('ticks whole steps only', () => {
    const sim = make();
    sim.step(0.05, START_HOUR);
    expect(sim.state().t).toBe(0);
    expect(sim.alpha).toBeCloseTo(0.5);
    sim.step(0.05, START_HOUR);
    expect(sim.state().t).toBeCloseTo(TICK);
    expect(sim.alpha).toBeCloseTo(0);
  });

  it('remembers each motion one tick back', () => {
    const sim = make();
    sim.step(30, START_HOUR + 0.5); // under way
    const was = sim.agents.map((a) => ({ ...a.motion }));
    sim.step(TICK, START_HOUR + 0.5);
    sim.agents.forEach((a, i) => expect(sim.prev(a.id)).toEqual(was[i]));
    expect(sim.agents.some((a, i) => a.motion.x !== was[i].x)).toBe(true);
  });

  it('copies its state', () => {
    const sim = make();
    sim.step(1, START_HOUR);
    const s = sim.state();
    s.agents[0].motion.x += 100;
    s.agents[0].needs.hunger = 5;
    expect(sim.agents[0].motion.x).not.toBe(s.agents[0].motion.x);
    expect(sim.agents[0].needs.hunger).not.toBe(5);
  });

  it('carries on from a saved state exactly', { timeout: 30_000 }, () => {
    const a = make(3);
    run(a, 120, 16 * TICK);
    const b = new Sim(world, { seed: 3, species: nativeDefs(), state: a.state() });
    for (const sim of [a, b]) for (let i = 0; i < 200; i++) sim.step(16 * TICK, START_HOUR + 2 + (i * 16 * TICK) / ANIMAL_S_PER_HOUR);
    expect(b.state()).toEqual(a.state());
  });

  it('carries on exactly from a state that went through JSON, mid side step', { timeout: 30_000 }, () => {
    // a wood of thin trunks every 10 m, so walkers side-step often
    const GAP = 10, R = 0.3;
    const wood: SimWorld = {
      ...world,
      trunksNear(x: number, z: number, r: number) {
        const out: { x: number; z: number; r: number }[] = [];
        for (let i = Math.ceil((x - r - R) / GAP); i * GAP <= x + r + R; i++)
          for (let j = Math.ceil((z - r - R) / GAP); j * GAP <= z + r + R; j++) if (Math.hypot(i * GAP - x, j * GAP - z) <= r + R) out.push({ x: i * GAP, z: j * GAP, r: R });
        return out;
      },
    };
    const a = new Sim(wood, { seed: 4, species: nativeDefs() });
    let hours = START_HOUR, steps = 0;
    const go = (sim: Sim) => sim.step(TICK, hours);
    do {
      hours += TICK / ANIMAL_S_PER_HOUR;
      go(a);
      // until one is mid side step on its way to its place (the detour and the place one object, two after JSON)
    } while (!a.agents.some((x) => x.detour && x.place && x.detour.x === x.place.x && x.detour.z === x.place.z) && ++steps < 20_000);
    const mid = a.agents.filter((x) => x.detour);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.some((x) => x.place && x.detour!.x === x.place.x && x.detour!.z === x.place.z)).toBe(true); // shared once, two objects after JSON
    const b = new Sim(wood, { seed: 4, species: nativeDefs(), state: JSON.parse(JSON.stringify(a.state())) });
    for (let i = 0; i < 600; i++) {
      hours += TICK / ANIMAL_S_PER_HOUR;
      go(a);
      go(b);
    }
    expect(b.state()).toEqual(a.state());
  });

  it('adds and removes species, and knows who hunts whom', () => {
    const defs = nativeDefs(), of = (id: string) => defs.filter((d) => d.id === id);
    const sim = new Sim(world, { seed: 5, species: [...of('fox'), ...of('deer')] });
    const hungryFox = () => {
      sim.setNeeds('fox#0', { hunger: 0.95, thirst: 0, tired: 0 });
      sim.step(1, 6);
      return sim.get('fox#0')!.doing;
    };
    expect(hungryFox()).toBe('forage'); // nothing it can hunt: berries
    const rabbit = of('rabbit')[0];
    const added = sim.addSpecies({ ...rabbit, id: 'gallery-1', name: 'Spotty Longlegs', released: true, target: 3, seeds: [11, 22, 33] });
    expect(added.map((a) => [a.id, a.seed])).toEqual([['gallery-1#0', 11], ['gallery-1#1', 22], ['gallery-1#2', 33]]);
    expect(sim.drain()).toEqual(added.map((a) => ({ type: 'added', id: a.id })));
    expect(hungryFox()).toBe('search'); // now there are rabbits
    sim.removeSpecies('gallery-1');
    expect(sim.agents.filter((a) => a.species === 'gallery-1').every((a) => a.doing === 'leave')).toBe(true); // walking out
    sim.step(TICK, 6); // nobody sees them go (no view set)
    expect(sim.drain()).toEqual(added.map((a) => ({ type: 'removed', id: a.id })));
    expect(sim.agents.some((a) => a.species === 'gallery-1')).toBe(false);
    expect(hungryFox()).toBe('forage');
  });

  it('sends a frightened animal off its errand, standing alert while it knows of no danger', () => {
    const sim = make();
    sim.step(30, START_HOUR + 0.5); // under way
    sim.setNeeds('deer#1', { fear: 0.9 });
    sim.step(TICK, START_HOUR + 0.5);
    const a = sim.get('deer#1')!;
    expect(a.doing).toBe('flee');
    expect(a.motion.target).toBeNull();
    expect(a.pose.ears).toBe('alert');
  });

  it('sets needs on request', () => {
    const sim = make();
    sim.setNeeds('deer#2', { thirst: 0.9 });
    expect(sim.get('deer#2')!.needs.thirst).toBe(0.9);
  });

  describe('over one valley day', () => {
    const doings = new Map<string, Set<Doing>>();
    const wrong: string[] = [];
    const kinds = new Set<MomentKind>();
    let sim: Sim;

    beforeAll(() => {
      sim = make(7); // newcomers on: a caught animal's kind is made up during the day
      sim.moments.on((m) => kinds.add(m.kind));
      for (const a of sim.agents) doings.set(a.id, new Set());
      run(sim, DAY, TICK, () => {
        for (const a of sim.agents) {
          doings.get(a.id)?.add(a.doing); // (the first animals' day: a newcomer has not had a whole one)
          const t = sim.traits(a.species), m = a.motion, wet = world.isWater(m.x, m.z);
          if (!t.swimmer && !t.floater && !m.flying && wet) wrong.push(`${a.id} in the water at ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`);
          if (t.swimmer && !wet) wrong.push(`${a.id} on land at ${m.x.toFixed(1)}, ${m.z.toFixed(1)}`);
        }
      });
    }, 60_000);

    it('every animal eats, drinks and sleeps within a day', () => {
      for (const a of sim.agents.filter((b) => doings.has(b.id))) {
        const t = sim.traits(a.species), did = doings.get(a.id)!;
        if (!(t.smallFood && !t.grazer)) expect(did.has(HUNTERS.includes(a.species) ? 'search' : 'graze'), `${a.id} fed`).toBe(true);
        if (!t.swimmer) expect(did.has('drink'), `${a.id} drank`).toBe(true);
        expect(did.has('sleep') || did.has('rest'), `${a.id} rested`).toBe(true);
      }
    });

    it('walkers stay dry and fish stay wet', () => {
      expect(wrong.slice(0, 5)).toEqual([]);
    });

    it('reports grazing, drinking, resting, rafting ducks and calling frogs', () => {
      for (const k of ['graze', 'drink', 'raft', 'chorus'] as const) expect(kinds.has(k), k).toBe(true);
      expect(kinds.has('rest') || kinds.has('sleep')).toBe(true);
    });
  });
});

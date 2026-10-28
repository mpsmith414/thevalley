import { describe, expect, it } from 'vitest';
import { reach } from '../../src/sim/behaviours/hunt';
import { between } from '../../src/sim/senses';
import { flight } from '../../src/sim/behaviours/flee';
import { KEEP_OFF, Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Agent, type Moment, type Pt } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const defs = nativeDefs();
/** A simulation of just these species, at `seed`. */
const only = (seed: number, ...ids: string[]) => new Sim(world, { seed, species: defs.filter((d) => ids.includes(d.id)) });
const centre = (as: Agent[]) => ({ x: as.reduce((s, a) => s + a.motion.x, 0) / as.length, z: as.reduce((s, a) => s + a.motion.z, 0) / as.length });
/** Puts an animal at `p`, standing, with nowhere to go. */
const put = (a: Agent, p: Pt) => Object.assign(a.motion, { x: p.x, z: p.z, speed: 0, target: null });
/** A dry spot `d` m from `p`, the first of a few ways round that is dry. */
function dryAt(p: Pt, d: number): Pt {
  for (let k = 0; k < 16; k++) {
    const q = { x: p.x + Math.sin((k * Math.PI) / 8) * d, z: p.z + Math.cos((k * Math.PI) / 8) * d };
    if (!world.isWater(q.x, q.z)) return q;
  }
  throw new Error('no dry spot');
}

/** A clock that runs a simulation tick by tick from `hours` (5 in the evening by default: foxes are about). */
function clock(sim: Sim, hours = 17) {
  return {
    /** Runs `seconds` animal seconds (or until `until` holds); `each` after every tick. Returns the seconds run. */
    run(seconds: number, each?: () => void, until?: () => boolean): number {
      for (let i = 0; i < Math.round(seconds / TICK); i++) {
        if (until?.()) return i * TICK;
        hours += TICK / ANIMAL_S_PER_HOUR;
        sim.step(TICK, hours);
        each?.();
      }
      return seconds;
    },
    pause(times: number) {
      for (let i = 0; i < times; i++) sim.step(0, hours);
    },
  };
}

/** `fox` very hungry and the other foxes fed, none thirsty or tired, `fox` choosing afresh what to do. */
function fed(sim: Sim, fox: Agent) {
  for (const f of sim.agents.filter((a) => a.species === 'fox')) sim.setNeeds(f.id, { hunger: f === fox ? 1 : 0, thirst: 0, tired: 0 });
  sim.ctx.done(fox);
}

/** Every moment the simulation tries to tell (cool-downs aside), in order. */
function heard(sim: Sim): Omit<Moment, 'id'>[] {
  const out: Omit<Moment, 'id'>[] = [], emit = sim.moments.emit.bind(sim.moments);
  sim.moments.emit = (m, group) => (out.push(m), emit(m, group));
  return out;
}

/** Run until most of the rabbits are grazing, head down. */
const grazing = (c: ReturnType<typeof clock>, rabbits: Agent[]) =>
  c.run(600, undefined, () => rabbits.filter((a) => a.doing === 'graze' && a.pose.headDown >= 1).length >= Math.min(5, rabbits.length));

/** Rabbits and foxes at `seed`, once the rabbits graze; one fox placed hungry 60 m from them (the other foxes fed). */
function hungryFox(seed = 7) {
  const sim = only(seed, 'rabbit', 'fox'), c = clock(sim), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
  grazing(c, rabbits);
  const fox = sim.get('fox#0')!;
  fed(sim, fox);
  put(fox, dryAt(centre(rabbits), 60));
  return { sim, c, fox, rabbits };
}

describe('the hunt', () => {
  it('a hungry fox 60 m from the rabbits stalks, then chases, and the chase ends in a catch or an escape', () => {
    const { sim, c, fox } = hungryFox();
    const told = heard(sim), mine = () => told.filter((m) => m.actors.includes(fox.id));
    c.run(3 * ANIMAL_S_PER_HOUR, undefined, () => mine().some((m) => m.kind === 'chase'));
    const kinds = mine().map((m) => m.kind);
    expect(kinds).toContain('chase');
    expect(kinds.indexOf('stalk')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('stalk')).toBeLessThan(kinds.indexOf('chase'));
    const chase = mine().find((m) => m.kind === 'chase')!, prey = chase.actors[chase.actors.length - 1];
    expect(chase.text).toMatch(/^The red fox(es)? (is|are) chasing a rabbit!$/);
    const took = c.run(30, undefined, () => told.some((m) => (m.kind === 'catch' || m.kind === 'escape') && m.actors.includes(prey)));
    expect(took).toBeLessThan(30);
  });

  it('a catch: the prey lies down and sinks into the earth in five seconds and is gone; the fox eats, then rests, full', () => {
    const sim = only(7, 'rabbit', 'fox'), c = clock(sim), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
    grazing(c, rabbits);
    sim.ctx.forceCatch = true;
    const fox = sim.get('fox#0')!, r = rabbits.find((a) => a.doing === 'graze')!;
    fed(sim, fox);
    put(fox, dryAt(r.motion, 15)); // near enough that it freezes rather than wanders off as the fox creeps up
    rabbits.forEach((a) => (a.stamina = 0)); // the rabbits are winded: the fox will reach one
    sim.drain();
    const caught = () => sim.agents.find((a) => a.doing === 'returning');
    expect(c.run(60, undefined, () => !!caught())).toBeLessThan(60);
    const prey = caught()!, eater = sim.agents.find((a) => a.doing === 'eat' && a.focus === prey.id)!;
    expect(eater.species).toBe('fox');
    expect(prey.pose.sleep).toBe(1);
    const at = { x: prey.motion.x, z: prey.motion.z }, from = prey.since;
    let full = -1;
    const sunk = c.run(10, () => prey.sink < 1 && (full = sim.ctx.t), () => prey.sink >= 1);
    expect(sunk).toBeLessThan(10);
    expect(full - from + TICK).toBeGreaterThan(4.8);
    expect(full - from + TICK).toBeLessThan(5.2);
    expect(prey.motion.x).toBe(at.x); // it lies still where it was caught
    c.run(TICK);
    expect(sim.get(prey.id)).toBeUndefined();
    expect(sim.drain()).toContainEqual({ type: 'removed', id: prey.id });
    // the fox eats at the place for half a minute, then rests with its hunger gone
    expect(eater.pose.mouth).toBe('chew');
    expect(eater.pose.headDown).toBe(1);
    const ate = eater.since;
    c.run(40, undefined, () => eater.doing !== 'eat');
    expect(eater.doing).toBe('rest');
    expect(eater.since - ate).toBeCloseTo(30, 0);
    expect(eater.needs.hunger).toBe(0);
    expect(eater.fedDay).toBe(0);
    const catches = sim.moments.recent().filter((m) => m.kind === 'catch');
    expect(catches.map((m) => m.text)).toEqual([expect.stringMatching(/^The red fox(es)? (has|have) caught (its|their) supper\.$/)]);
  });

  it('names a released creature it catches', () => {
    const sim = only(7, 'fox'), c = clock(sim);
    const rabbit = defs.find((d) => d.id === 'rabbit')!;
    const [spotty] = sim.addSpecies({ ...rabbit, id: 'gallery-1', name: 'Spotty Longlegs', released: true, target: 1, seeds: [11] });
    grazing(c, [spotty]);
    sim.ctx.forceCatch = true;
    const fox = sim.get('fox#0')!;
    fed(sim, fox);
    put(fox, dryAt(spotty.motion, 30));
    spotty.stamina = 0;
    c.run(90, undefined, () => spotty.doing === 'returning');
    expect(spotty.doing).toBe('returning');
    expect(sim.moments.recent().find((m) => m.kind === 'catch')?.text).toMatch(/^The red fox(es)? (has|have) caught Spotty Longlegs\.$/);
  });

  it('a pack calls together for 2–3 s before it sets off at dusk', () => {
    const sim = only(7, 'wolf', 'deer'), c = clock(sim, 19.5), wolves = sim.agents.filter((a) => a.species === 'wolf');
    c.run(1);
    for (const w of wolves) {
      sim.setNeeds(w.id, { hunger: 1, thirst: 0, tired: 0 });
      sim.ctx.done(w);
    }
    const called = new Map<string, number>();
    c.run(6, () => wolves.forEach((w) => w.pose.calling && called.set(w.id, (called.get(w.id) ?? 0) + TICK)));
    const leader = wolves.find((w) => w.leader)!;
    expect(called.get(leader.id)).toBeGreaterThanOrEqual(2 - 1e-6);
    expect(called.get(leader.id)).toBeLessThanOrEqual(3 + 1e-6);
    expect(called.size).toBe(wolves.length);
    expect(wolves.every((w) => w.doing === 'search' && !w.pose.calling)).toBe(true);
  });

  it('only a hungry hunter that has not eaten a catch today starts a hunt', () => {
    /** Wolves 40 m from grazing deer and the hawks over grazing rabbits, all with `hunger` and fed on `fedDay`; the hunts they start in a minute. */
    const hunts = (hunger: number, fedDay: (day: number) => number) => {
      const sim = only(7, 'deer', 'rabbit', 'wolf', 'hawk'), c = clock(sim, 6.5);
      const deer = sim.agents.filter((a) => a.species === 'deer'), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
      grazing(c, rabbits);
      const told = heard(sim), hunters = sim.agents.filter((a) => a.species === 'wolf' || a.species === 'hawk');
      for (const h of hunters) {
        if (h.species === 'wolf') put(h, dryAt(centre(deer), 40));
        else Object.assign(h.motion, { ...centre(rabbits), altitude: 30, flying: true, wantFly: true, cruise: 30, target: null });
        sim.setNeeds(h.id, { hunger, thirst: 0, tired: 0 });
        h.fedDay = fedDay(sim.ctx.day);
        sim.ctx.done(h);
      }
      const started = new Set<string>();
      c.run(60, () => hunters.forEach((h) => ['stalk', 'chase', 'dive'].includes(h.doing) && started.add(h.doing)));
      return { started: [...started], told: told.filter((m) => ['stalk', 'chase', 'dive'].includes(m.kind)).length };
    };
    expect(hunts(1, () => -1).told).toBeGreaterThan(0); // hungry: they do hunt
    expect(hunts(0.3, () => -1)).toEqual({ started: [], told: 0 }); // sated
    expect(hunts(1, (day) => day)).toEqual({ started: [], told: 0 }); // fed today
  });

  it('a dive catches only within reach of its prey', () => {
    let catches = 0;
    for (let seed = 1; seed <= 6; seed++) {
      let ends = 0;
      const sim = only(seed, 'rabbit', 'hawk'), c = clock(sim, 6.5), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
      grazing(c, rabbits);
      sim.ctx.forceCatch = true;
      const hawk = sim.get('hawk#0')!, emit = sim.moments.emit.bind(sim.moments), near: number[] = [];
      sim.moments.emit = (m, group) => {
        if (m.kind === 'catch') near.push(between(sim.get(m.follow)!, sim.get(m.actors[m.actors.length - 1])!));
        if (m.kind === 'catch' || m.kind === 'escape') ends++;
        return emit(m, group);
      };
      Object.assign(hawk.motion, { ...centre(rabbits), altitude: 30, flying: true, wantFly: true, cruise: 30, target: null });
      sim.setNeeds(hawk.id, { hunger: 1, thirst: 0, tired: 0 });
      sim.ctx.done(hawk);
      c.run(120, undefined, () => hawk.doing === 'eat' || ends > 0);
      for (const d of near) expect(d, `seed ${seed}`).toBeLessThanOrEqual(reach(sim.traits('hawk')) + 1e-9);
      catches += near.length;
    }
    expect(catches).toBeGreaterThan(0);
  });

  it("a fox rests and forages outside the rabbits' home and cover, by their flight distance and a margin", () => {
    const sim = new Sim(world, { seed: 7, species: nativeDefs() }), rt = sim.traits('rabbit'), gap = flight(rt) + KEEP_OFF;
    const home = defs.find((d) => d.id === 'rabbit')!.home, cover = sim.ctx.places.restSpots(home, rt);
    const outside = (p: Pt) => Math.min(Math.hypot(p.x - home.center.x, p.z - home.center.z) - home.radius, ...cover.map((c) => Math.hypot(p.x - c.x, p.z - c.z))) - gap;
    // the spots it picks
    for (const fox of sim.agents.filter((a) => a.species === 'fox')) {
      const t = sim.traits('fox'), own = sim.ctx.home(fox), keep = sim.ctx.keepOff(fox)!;
      for (let i = 0; i < 10; i++) {
        expect(outside(sim.ctx.places.restSpot(own, t, fox.motion, keep)), `${fox.id} rest`).toBeGreaterThanOrEqual(0);
        expect(outside(sim.ctx.places.forageSpot(own, t, own.center, keep)), `${fox.id} forage`).toBeGreaterThanOrEqual(0);
      }
    }
    expect(sim.ctx.keepOff(sim.get('deer#0')!)).toBeUndefined();
    // and where the foxes go to sleep and forage over half a valley day (a pair's follower beside its leader's spot)
    const c = clock(sim, START_HOUR), wrong: string[] = [];
    c.run(12 * ANIMAL_S_PER_HOUR, () => {
      for (const fox of sim.agents.filter((a) => a.species === 'fox' && (a.doing === 'sleep' || a.doing === 'forage') && a.place))
        if (outside(fox.place!) < -2) wrong.push(`${fox.id} ${fox.doing} at ${fox.place!.x.toFixed(0)}, ${fox.place!.z.toFixed(0)}`);
    });
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('a fox that rested where a hunt ended picks a place away from the rabbits once that rest is over', () => {
    const sim = only(7, 'fox', 'rabbit'), fox = sim.get('fox#0')!, home = defs.find((d) => d.id === 'rabbit')!.home;
    sim.ctx.newcomers = false;
    const c = clock(sim, 2); // the small hours: it beds down
    put(fox, home.center);
    sim.setNeeds(fox.id, { hunger: 0, thirst: 0, tired: 0.8 });
    sim.ctx.become(fox, 'rest');
    fox.place = { x: home.center.x, z: home.center.z }; // as `missed` leaves it
    fox.until = 20;
    const keep = () => sim.ctx.keepOff(fox)!;
    c.run(10);
    expect(fox.place).toEqual(home.center); // resting where the hunt ended, for now
    let chosen: number | null = null;
    c.run(30, () => {
      if (chosen === null && (fox.doing === 'rest' || fox.doing === 'sleep') && fox.place && fox.place.x !== home.center.x) chosen = keep()(fox.place); // as picked
    }, () => chosen !== null);
    expect(chosen).not.toBeNull();
    expect(chosen!).toBeGreaterThanOrEqual(0);
  });

  it('pausing holds a chase exactly where it is', () => {
    const start = () => {
      const { sim, c } = hungryFox();
      c.run(3 * ANIMAL_S_PER_HOUR, undefined, () => sim.agents.some((a) => a.doing === 'chase'));
      return { sim, c };
    };
    const a = start(), b = start();
    expect(a.sim.agents.some((x) => x.doing === 'chase')).toBe(true);
    a.c.run(3);
    a.c.pause(100);
    a.c.run(3);
    b.c.run(6);
    expect(a.sim.state()).toEqual(b.sim.state());
  });

  it('carries on exactly from a state that went through JSON, mid-chase', () => {
    const { sim, c } = hungryFox();
    c.run(3 * ANIMAL_S_PER_HOUR, undefined, () => sim.agents.some((a) => a.doing === 'chase'));
    expect(sim.state().governor.chase).not.toBeNull();
    const copy = new Sim(world, { seed: 7, species: defs.filter((d) => d.id === 'rabbit' || d.id === 'fox'), state: JSON.parse(JSON.stringify(sim.state())) });
    const cc = clock(copy, sim.ctx.hours);
    for (let i = 0; i < 600; i++) (c.run(TICK), cc.run(TICK));
    expect(copy.state()).toEqual(sim.state());
  });

  it('over a valley day in each of ten valleys: several stalks and chases, one to three catches, most chases end in escape', { timeout: 120_000 }, () => {
    const DAY = 24 * ANIMAL_S_PER_HOUR, dt = 16 * TICK, tally = { stalk: 0, chase: 0, catch: 0, escape: 0 };
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new Sim(world, { seed, species: nativeDefs() }), told = heard(sim);
      let hours = START_HOUR;
      for (let i = 0; i < DAY / dt; i++) sim.step(dt, (hours += dt / ANIMAL_S_PER_HOUR));
      for (const m of told) {
        if (m.kind === 'stalk' || m.kind === 'catch' || m.kind === 'escape') tally[m.kind]++;
        if (m.kind === 'chase' || m.kind === 'dive') tally.chase++;
      }
    }
    const per = (n: number) => n / 10;
    expect(per(tally.stalk)).toBeGreaterThanOrEqual(3);
    expect(per(tally.chase)).toBeGreaterThanOrEqual(2);
    expect(per(tally.catch)).toBeGreaterThanOrEqual(1);
    expect(per(tally.catch)).toBeLessThanOrEqual(3);
    expect(tally.escape / tally.chase).toBeGreaterThanOrEqual(0.6);
  });
});

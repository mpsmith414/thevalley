import { describe, expect, it } from 'vitest';
import { CATCHES_PER_DAY, Governor } from '../../src/sim/governor';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Agent, type Moment, type Pt, type SimState } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { quadruped } from '../fixtures/recipes';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const defs = nativeDefs();
const DAY = 24 * ANIMAL_S_PER_HOUR;
const hunter = (id: string, fedDay = -1) => ({ id, fedDay }) as Agent;
const centre = (as: Agent[]): Pt => ({ x: as.reduce((s, a) => s + a.motion.x, 0) / as.length, z: as.reduce((s, a) => s + a.motion.z, 0) / as.length });
/** A dry spot `d` m from `p`. */
function dryAt(p: Pt, d: number): Pt {
  for (let k = 0; k < 16; k++) {
    const q = { x: p.x + Math.sin((k * Math.PI) / 8) * d, z: p.z + Math.cos((k * Math.PI) / 8) * d };
    if (!world.isWater(q.x, q.z)) return q;
  }
  throw new Error('no dry spot');
}

/** A meat-eater a kid made (any prey up to 2 m long), as a released family of two living by the deer or the rabbits. */
function carnivores(k: number) {
  const recipe = {
    ...quadruped, id: `carnivore-${k}`,
    life: { ...quadruped.life, sizeM: 0.9, topSpeed: 10, stamina: 0.6 },
    mind: { ...quadruped.mind, plants: [], preyMin: 0.2, preyMax: 2, social: 'solitary' as const, activity: 'twilight' as const },
  };
  const home = defs.find((d) => d.id === (k % 2 ? 'deer' : 'rabbit'))!.home;
  return { id: `gallery-${k}`, name: `Biter ${k}`, recipe, home: { ...home, species: `gallery-${k}`, radius: 80 }, target: 2, released: true, seeds: [k * 10 + 1, k * 10 + 2] };
}

/**
 * Runs `sim` tick by tick for `days` valley days, checking each tick that at most one hunt is chasing (a pack or a pair
 * chases together: one hunt), and noting each day's catches (by the hunter that made it).
 */
function watch(sim: Sim, days: number) {
  const catches: Omit<Moment, 'id'>[] = [], emit = sim.moments.emit.bind(sim.moments);
  sim.moments.emit = (m, group) => (m.kind === 'catch' && catches.push(m), emit(m, group));
  const together = (a: Agent) => ['pack', 'pair'].includes(sim.traits(a.species).social);
  let hours = START_HOUR, most = 0, chasing = 0;
  const wrong: string[] = [];
  for (let i = 0; i < Math.round((days * DAY) / TICK); i++) {
    sim.step(TICK, (hours += TICK / ANIMAL_S_PER_HOUR));
    const hunts = new Set(sim.agents.filter((a) => a.doing === 'chase' || a.doing === 'dive').map((a) => (together(a) ? a.group : a.id)));
    if (hunts.size > 1) wrong.push(`${hours.toFixed(2)} h: ${[...hunts].join(', ')}`);
    if (hunts.size) chasing++;
    most = Math.max(most, hunts.size);
  }
  const perDay = new Map<number, string[]>();
  for (const m of catches) perDay.set(Math.floor(m.hours / 24), [...(perDay.get(Math.floor(m.hours / 24)) ?? []), m.follow]);
  return { wrong, chasing, perDay };
}

describe('the valley-wide limit', () => {
  it('allows one chase at a time, a few catches a day, and no predator two in a day', () => {
    const st: SimState['governor'] = { day: 0, catches: 0, chase: null }, g = new Governor(st);
    const fox = hunter('fox#0'), wolf = hunter('wolf#0');
    expect(g.mayChase(fox, 0)).toBe(true);
    g.startChase(fox);
    expect(g.chase).toBe('fox#0');
    expect(g.mayChase(wolf, 0)).toBe(false);
    g.endChase(wolf); // not its chase: nothing changes
    expect(g.mayChase(wolf, 0)).toBe(false);
    g.endChase(fox);
    expect(g.mayChase(wolf, 0)).toBe(true);
    expect(g.mayCatch(fox, 0)).toBe(true);
    g.caught(fox, 0);
    expect(fox.fedDay).toBe(0);
    expect(g.mayCatch(fox, 0)).toBe(false); // it has eaten today
    for (let k = 1; k < CATCHES_PER_DAY; k++) g.caught(hunter(`hawk#${k}`), 0);
    expect(st.catches).toBe(CATCHES_PER_DAY);
    expect(g.mayCatch(wolf, 0)).toBe(false);
    expect(g.mayChase(wolf, 0)).toBe(true); // the day's catches are used up: chases still happen, but end in escapes
    // a new day
    expect(g.mayChase(wolf, 1)).toBe(true);
    expect(g.mayCatch(fox, 1)).toBe(true);
    expect(st).toEqual({ day: 1, catches: 0, chase: null });
    // the state is plain data: a copy through JSON carries on the same
    g.caught(wolf, 1);
    const copy = new Governor(JSON.parse(JSON.stringify(st)));
    expect(copy.mayCatch(wolf, 1)).toBe(false);
    expect(copy.mayCatch(fox, 1)).toBe(true);
  });

  it('never two chases at once, with two hungry wolves and two hungry foxes near their prey, over a valley day', { timeout: 60_000 }, () => {
    const sim = new Sim(world, { seed: 7, species: defs.filter((d) => ['deer', 'rabbit', 'wolf', 'fox'].includes(d.id)) });
    sim.step(1, START_HOUR);
    const deer = sim.agents.filter((a) => a.species === 'deer'), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
    for (const [id, near] of [['wolf#0', deer], ['wolf#1', deer], ['fox#0', rabbits], ['fox#2', rabbits]] as const) {
      const a = sim.get(id)!;
      Object.assign(a.motion, { ...dryAt(centre(near), 40), speed: 0, target: null });
      sim.setNeeds(id, { hunger: 1, thirst: 0, tired: 0 });
      sim.ctx.done(a);
    }
    const { wrong, chasing } = watch(sim, 1);
    expect(chasing).toBeGreaterThan(0);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('holds with ten released carnivore families too: one chase at a time, at most three catches a day, none twice by one hunter', { timeout: 60_000 }, () => {
    const sim = new Sim(world, { seed: 7, species: defs.filter((d) => ['deer', 'rabbit', 'wolf', 'fox'].includes(d.id)) });
    for (let k = 1; k <= 10; k++) sim.addSpecies(carnivores(k));
    expect(sim.agents.filter((a) => a.species.startsWith('gallery-')).length).toBe(20);
    const { wrong, chasing, perDay } = watch(sim, 3);
    expect(chasing).toBeGreaterThan(0);
    expect(wrong.slice(0, 5)).toEqual([]);
    for (const [day, by] of perDay) {
      expect(by.length, `day ${day}`).toBeLessThanOrEqual(CATCHES_PER_DAY);
      expect(new Set(by).size, `day ${day}: ${by.join(', ')}`).toBe(by.length);
    }
  });
});

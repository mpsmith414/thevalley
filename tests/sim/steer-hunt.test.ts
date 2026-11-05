import { describe, expect, it } from 'vitest';
import { CATCHES_PER_DAY } from '../../src/sim/governor';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Agent, type Doing, type Moment, type Pt, type SteerInput } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const defs = nativeDefs();
/** A simulation of just these species, at `seed`. */
const only = (seed: number, ...ids: string[]) => new Sim(world, { seed, species: defs.filter((d) => ids.includes(d.id)) });
const dist = (a: Agent, b: Agent) => Math.hypot(a.motion.x - b.motion.x, a.motion.z - b.motion.z);
/** Puts an animal at `p`, standing, with nowhere to go. */
const put = (a: Agent, p: Pt) => Object.assign(a.motion, { x: p.x, z: p.z, speed: 0, target: null });
/** A push on the stick: heading `yaw`, walking at `speed` of its walk, or running. */
const input = (yaw: number, speed: number, run = false): SteerInput => ({ yaw, speed, run, fly: 0, act: false });
/** The heading (the sim's `atan2(dx, dz)`) from `a` to `b`. */
const toward = (a: Agent, b: Agent) => Math.atan2(b.motion.x - a.motion.x, b.motion.z - a.motion.z);
/** Running flat out straight at `b`. */
const runAt = (a: Agent, b: Agent) => input(toward(a, b), 1, true);
/** Under the player's steering again. */
const STEERED = new Set<Doing>(['walk', 'watch']);

/** A dry spot `d` m from `p`, the first of a few ways round that is dry. */
function dryAt(p: Pt, d: number): Pt {
  for (let k = 0; k < 16; k++) {
    const q = { x: p.x + Math.sin((k * Math.PI) / 8) * d, z: p.z + Math.cos((k * Math.PI) / 8) * d };
    if (!world.isWater(q.x, q.z)) return q;
  }
  throw new Error('no dry spot');
}

/** A clock that runs a simulation tick by tick from `hours`. */
function clock(sim: Sim, hours: number) {
  return {
    /** Runs `seconds` animal seconds (or until `until` holds); `each` before every tick. Returns the seconds run. */
    run(seconds: number, each?: () => void, until?: () => boolean): number {
      for (let i = 0; i < Math.round(seconds / TICK); i++) {
        if (until?.()) return i * TICK;
        each?.();
        hours += TICK / ANIMAL_S_PER_HOUR;
        sim.step(TICK, hours);
      }
      return seconds;
    },
  };
}

/** Every moment the simulation tries to tell (cool-downs aside), in order. */
function heard(sim: Sim): Omit<Moment, 'id'>[] {
  const out: Omit<Moment, 'id'>[] = [], emit = sim.moments.emit.bind(sim.moments);
  sim.moments.emit = (m, group) => (out.push(m), emit(m, group));
  return out;
}

/** Rabbits and foxes at 5 in the evening, once the rabbits graze; the first fox `d` m from a grazing rabbit, facing it. */
function foxByRabbit(d: number, seed = 7) {
  const sim = only(seed, 'rabbit', 'fox'), c = clock(sim, 17), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
  c.run(600, undefined, () => rabbits.filter((a) => a.doing === 'graze' && a.pose.headDown >= 1).length >= 5);
  const fox = sim.get('fox#0')!, rabbit = rabbits.find((a) => a.doing === 'graze')!;
  put(fox, dryAt(rabbit.motion, d));
  fox.motion.yaw = toward(fox, rabbit);
  return { sim, c, fox, rabbit, rabbits, told: heard(sim) };
}

/** The steered fox running at the rabbit until its chase has begun. */
function chasing(d = 6) {
  const f = foxByRabbit(d);
  f.sim.steer(f.fox.id, runAt(f.fox, f.rabbit));
  f.c.run(TICK);
  expect(f.fox.doing).toBe('chase');
  return { ...f, rabbit: f.sim.ctx.get(f.fox.focus)! }; // the one it chases (the nearest it was run at)
}

/** Steers `a` at the prey it is after, each tick, until the hunt ends or `seconds` pass. */
function runDown(sim: Sim, c: ReturnType<typeof clock>, a: Agent, seconds: number) {
  return c.run(seconds, () => {
    const prey = sim.ctx.get(a.focus);
    if (prey) sim.steer(a.id, runAt(a, prey));
  }, () => a.doing !== 'chase');
}

describe('steered hunting', () => {
  it('running at prey within lunge starts a chase', () => {
    const { sim, c, fox, rabbit, told } = foxByRabbit(6);
    sim.steer(fox.id, runAt(fox, rabbit));
    c.run(TICK);
    expect(fox.doing).toBe('chase');
    expect(sim.ctx.get(fox.focus)?.species).toBe('rabbit');
    expect(sim.ctx.governor.chase).toBe(fox.id);
    expect(told.some((m) => m.kind === 'chase' && m.follow === fox.id)).toBe(true);
  });

  it('only running, pushed well, and at the prey', () => {
    for (const push of [input(0, 1, false), input(0, 0.2, true), input(Math.PI / 2, 1, true)]) {
      const { sim, c, fox, rabbit } = foxByRabbit(6);
      sim.steer(fox.id, { ...push, yaw: toward(fox, rabbit) + push.yaw });
      c.run(TICK);
      expect(fox.doing).not.toBe('chase');
      expect(sim.ctx.governor.chase).toBeNull();
    }
  });

  it('not from beyond lunging range', () => {
    const { sim, c, fox, rabbit } = foxByRabbit(25);
    sim.steer(fox.id, runAt(fox, rabbit));
    c.run(TICK);
    expect(fox.doing).not.toBe('chase');
  });

  it('not while another chase is under way', () => {
    const { sim, c, fox, rabbit } = foxByRabbit(6);
    sim.ctx.governor.startChase(sim.get('fox#1')!);
    sim.steer(fox.id, runAt(fox, rabbit));
    c.run(TICK);
    expect(fox.doing).not.toBe('chase');
  });

  it('no chase while cooling down', () => {
    const { sim, c, fox, rabbit } = foxByRabbit(6);
    fox.cooldown = sim.ctx.hours + 1;
    sim.steer(fox.id, runAt(fox, rabbit));
    c.run(TICK);
    expect(fox.doing).not.toBe('chase');
    expect(sim.ctx.governor.chase).toBeNull();
  });

  it('no chase while winded: no chase, no escape, no cooldown, just steering', () => {
    const { sim, c, fox, rabbit, told } = foxByRabbit(6);
    fox.stamina = 0.05;
    sim.steer(fox.id, runAt(fox, rabbit));
    c.run(TICK);
    expect(STEERED.has(fox.doing)).toBe(true);
    expect(sim.ctx.governor.chase).toBeNull();
    expect(told.some((m) => m.kind === 'chase' || m.kind === 'escape')).toBe(false);
    expect(fox.cooldown).toBeLessThanOrEqual(sim.ctx.hours);
  });

  it('a chase over in the tick it began hands straight back to steering (no tick lying down)', () => {
    const { sim, c, fox, rabbit, told } = foxByRabbit(0.2); // on top of it: reached at once, and a rabbit with its breath dodges
    sim.steer(fox.id, runAt(fox, rabbit));
    c.run(TICK);
    expect(told.some((m) => m.kind === 'escape')).toBe(true);
    expect(fox.doing).toBe('walk');
  });

  it('the hunger gate is left out', () => {
    const { sim, c, fox, rabbit } = foxByRabbit(6);
    sim.setNeeds(fox.id, { hunger: 0 });
    sim.steer(fox.id, runAt(fox, rabbit));
    c.run(TICK);
    expect(fox.doing).toBe('chase');
  });

  it('turning away or letting go of run ends the chase as a miss', () => {
    for (const away of [(fox: Agent, r: Agent) => input(toward(fox, r) + (2 * Math.PI) / 3, 1, true), (fox: Agent, r: Agent) => input(toward(fox, r), 1, false)]) {
      const { sim, c, fox, rabbit, told } = chasing();
      sim.steer(fox.id, away(fox, rabbit));
      c.run(TICK);
      expect(told.some((m) => m.kind === 'escape' && m.actors.includes(rabbit.id))).toBe(true);
      expect(fox.cooldown).toBeGreaterThan(sim.ctx.hours);
      expect(sim.ctx.governor.chase).toBeNull();
      // straight back under steering (no lying down), and no new chase while it cools down
      expect(STEERED.has(fox.doing)).toBe(true);
      sim.steer(fox.id, runAt(fox, rabbit));
      c.run(1, () => expect(STEERED.has(fox.doing)).toBe(true));
    }
  });

  it('letting go of the stick ends the chase as a miss', () => {
    const { sim, c, fox, rabbit, told } = chasing();
    sim.steer(fox.id, input(toward(fox, rabbit), 0, true));
    c.run(TICK);
    expect(told.some((m) => m.kind === 'escape')).toBe(true);
    expect(fox.doing).toBe('watch');
  });

  it("the catch obeys the valley's limits", () => {
    const caught = chasing(3);
    caught.sim.ctx.forceCatch = true;
    caught.rabbits.forEach((a) => (a.stamina = 0)); // winded: the fox reaches one
    expect(runDown(caught.sim, caught.c, caught.fox, 30)).toBeLessThan(30);
    const prey = caught.told.find((m) => m.kind === 'catch')?.actors.at(-1);
    expect(prey).toBeDefined();
    expect(caught.sim.get(prey!)!.doing).toBe('returning');

    const spent = chasing(3), g = spent.sim.ctx.governor;
    spent.sim.ctx.forceCatch = true;
    spent.rabbits.forEach((a) => (a.stamina = 0));
    for (let i = 0; i < CATCHES_PER_DAY; i++) g.caught({ fedDay: -1 } as Agent, spent.sim.ctx.day);
    runDown(spent.sim, spent.c, spent.fox, 30);
    expect(spent.told.some((m) => m.kind === 'catch')).toBe(false);
    expect(spent.told.some((m) => m.kind === 'escape')).toBe(true);
    expect(spent.rabbits.some((a) => a.doing === 'returning')).toBe(false);
  });

  it('after a catch it eats, then steering comes back', () => {
    const { sim, c, fox, rabbits } = chasing(3);
    sim.ctx.forceCatch = true;
    rabbits.forEach((a) => (a.stamina = 0));
    runDown(sim, c, fox, 30);
    expect(fox.doing).toBe('eat');
    const at = { ...fox.motion }, from = sim.ctx.t;
    // the reins pause while it eats: pushing does not move it
    sim.steer(fox.id, input(0, 1, true));
    const ate = c.run(40, () => expect(Math.hypot(fox.motion.x - at.x, fox.motion.z - at.z)).toBeLessThan(0.5), () => fox.doing !== 'eat');
    expect(ate).toBeGreaterThan(29);
    expect(sim.ctx.t - from).toBeLessThan(31);
    expect(fox.needs.hunger).toBe(0);
    expect(STEERED.has(fox.doing)).toBe(true);
    c.run(2);
    expect(fox.doing).toBe('walk');
  });

  it('a steered hawk stoops by itself', () => {
    const sim = only(7, 'rabbit', 'hawk'), c = clock(sim, 6.5), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
    c.run(600, undefined, () => rabbits.filter((a) => a.doing === 'graze' && a.pose.headDown >= 1).length >= 5);
    const hawk = sim.get('hawk#0')!, rabbit = rabbits.find((a) => a.doing === 'graze')!, p = dryAt(rabbit.motion, 10);
    Object.assign(hawk.motion, { ...p, altitude: 30, flying: true, wantFly: true, cruise: 30, target: null, speed: 10 });
    hawk.motion.yaw = toward(hawk, rabbit);
    sim.steer(hawk.id, runAt(hawk, rabbit));
    c.run(TICK);
    expect(hawk.doing).toBe('dive');
    expect(sim.ctx.governor.chase).toBe(hawk.id);
  });

  it('a steered prey animal is never caught', () => {
    for (const steered of [false, true]) {
      const { sim, c, rabbit, told } = foxByRabbit(6), wild = sim.get('fox#2')!;
      sim.ctx.forceCatch = true;
      if (steered) sim.steer(rabbit.id, input(0, 0));
      // a wild fox at the end of its chase, all but on the rabbit
      put(wild, dryAt(rabbit.motion, 0.3));
      sim.ctx.become(wild, 'chase');
      wild.focus = rabbit.id;
      sim.ctx.governor.startChase(wild);
      c.run(TICK);
      expect(told.some((m) => m.kind === (steered ? 'escape' : 'catch')), `steered ${steered}`).toBe(true);
      expect(rabbit.doing === 'returning').toBe(!steered);
    }
  });

  it("pack mates join a steered wolf's chase", () => {
    const sim = only(7, 'wolf', 'deer'), c = clock(sim, 10), deer = sim.agents.filter((a) => a.species === 'deer');
    c.run(600, undefined, () => deer.filter((a) => a.doing === 'graze').length >= 4);
    const wolves = sim.agents.filter((a) => a.species === 'wolf'), lead = wolves.find((a) => a.leader)!, mates = wolves.filter((a) => a !== lead);
    const prey = deer.find((a) => a.doing === 'graze')!;
    put(lead, dryAt(prey.motion, 8));
    mates.forEach((m, k) => {
      put(m, dryAt(lead.motion, 6 + 4 * k));
      sim.setNeeds(m.id, { hunger: 1, thirst: 0, tired: 0 });
      sim.ctx.become(m, 'search');
    });
    sim.steer(lead.id, runAt(lead, prey));
    c.run(TICK);
    expect(lead.doing).toBe('chase');
    c.run(1, () => sim.ctx.get(lead.focus) && sim.steer(lead.id, runAt(lead, sim.ctx.get(lead.focus)!)));
    const near = mates.filter((m) => dist(m, lead) <= 40);
    expect(near.length).toBeGreaterThan(0);
    for (const m of near) {
      expect(m.doing, m.id).toBe('chase');
      expect(m.focus).toBe(lead.focus);
    }
  });

  it('a steered pack leader does not call the pack together; its mates call with the next', () => {
    const sim = only(7, 'wolf', 'deer'), c = clock(sim, 19.5), wolves = sim.agents.filter((a) => a.species === 'wolf');
    c.run(1);
    const lead = wolves.find((w) => w.leader)!;
    for (const w of wolves) {
      sim.setNeeds(w.id, { hunger: 1, thirst: 0, tired: 0 });
      sim.ctx.done(w);
    }
    sim.steer(lead.id, input(0, 0));
    const called = new Set<string>();
    c.run(6, () => wolves.forEach((w) => w.pose.calling && called.add(w.id)));
    expect(called.has(lead.id)).toBe(false);
    expect(called.size).toBe(wolves.length - 1);
    expect(lead.leader).toBe(true);
  });
});

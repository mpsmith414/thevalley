import { describe, expect, it } from 'vitest';
import { DO_S, Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Agent, type Doing, type Pt, type SteerInput } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const defs = nativeDefs();
/** A simulation of just these species (all of them with none named), at `seed`. */
const make = (seed: number, ...ids: string[]) => new Sim(world, { seed, species: ids.length ? defs.filter((d) => ids.includes(d.id)) : defs });
const dist = (a: Agent, p: Pt) => Math.hypot(a.motion.x - p.x, a.motion.z - p.z);
const centre = (as: Agent[]) => ({ x: as.reduce((s, a) => s + a.motion.x, 0) / as.length, z: as.reduce((s, a) => s + a.motion.z, 0) / as.length });
/** Puts an animal at `p`, standing, with nowhere to go. */
const put = (a: Agent, p: Pt) => Object.assign(a.motion, { x: p.x, z: p.z, speed: 0, target: null });
/** A push on the stick: heading `yaw`, walking at `speed` of its walk, or running. */
const input = (yaw: number, speed: number, run = false): SteerInput => ({ yaw, speed, run, fly: 0, act: false });
/** Feeding where it stands or round its leader. */
const FEEDS = new Set<Doing>(['graze', 'forage']);
const DOINGS: Doing[] = ['rest', 'sleep', 'graze', 'forage', 'drink', 'walk', 'watch', 'call', 'search', 'stalk', 'chase', 'dive', 'eat', 'flee', 'freeze', 'hide', 'returning', 'arrive', 'leave'];

/** A clock that runs a simulation tick by tick from 9 in the morning. */
function clock(sim: Sim) {
  let hours = 9;
  return {
    /** Runs `seconds` animal seconds (or until `until` holds); `each` after every tick. */
    run(seconds: number, each?: () => void, until?: () => boolean) {
      for (let i = 0; i < Math.round(seconds / TICK); i++) {
        if (until?.()) return;
        hours += TICK / ANIMAL_S_PER_HOUR;
        sim.step(TICK, hours);
        each?.();
      }
    },
  };
}

/** The nearest point to `p` (on rings 2 m apart, out to `far` m) that passes `test`. */
function nearest(p: Pt, test: (x: number, z: number) => boolean, far = 300): Pt {
  for (let r = 2; r <= far; r += 2)
    for (let k = 0; k < 64; k++) {
      const ang = (k / 64) * Math.PI * 2, x = p.x + Math.sin(ang) * r, z = p.z + Math.cos(ang) * r;
      if (test(x, z)) return { x, z };
    }
  throw new Error('none near');
}

/** The heading (the sim's `atan2(dx, dz)`) from `a` to `p`. */
const toward = (a: Agent, p: Pt) => Math.atan2(p.x - a.motion.x, p.z - a.motion.z);
/** The angle between two headings (rad, 0 to pi). */
const between = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** The Do button going down, with the stick at rest. */
const DO: SteerInput = { ...input(0, 0), act: true };
/** The eight directions round a point, for looking about it. */
const AROUND = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4);
/** Dry ground 1.5 m from the water in some direction: where a Do is a drink. */
const wet = (x: number, z: number) => AROUND.some((r) => world.isWater(x + Math.sin(r) * 1.5, z + Math.cos(r) * 1.5));
const atBank = (x: number, z: number) => !world.isWater(x, z) && wet(x, z) && world.inside(x, z, 25);
/** Dry ground well away from the water. */
const bare = (x: number, z: number) => !world.isWater(x, z) && world.inside(x, z, 25) && AROUND.every((r) => !world.isWater(x + Math.sin(r) * 15, z + Math.cos(r) * 15));
/** Open meadow, clear of the forest and the water. */
const onMeadow = (x: number, z: number) => bare(x, z) && world.biomeAt(x, z).meadow > 0.6 && world.biomeAt(x, z).forest < 0.1;

describe('steering', () => {
  it('moves where it is steered', () => {
    const sim = make(7, 'deer'), c = clock(sim), deer = sim.get('deer#0')!, from = { ...deer.motion };
    deer.motion.yaw = Math.PI / 2; // already facing that way (a turn on the spot would carry it sideways a little)
    sim.steer(deer.id, input(Math.PI / 2, 1));
    expect(sim.steered).toBe(deer.id);
    c.run(10);
    expect(deer.motion.x - from.x).toBeGreaterThan(5);
    expect(Math.abs(deer.motion.z - from.z)).toBeLessThan(1);
    expect(deer.doing).toBe('walk');
  });

  it('stands still and watches with no push', () => {
    const sim = make(7, 'deer'), c = clock(sim), deer = sim.get('deer#0')!;
    sim.steer(deer.id, input(0, 0));
    c.run(3);
    expect(deer.motion.speed).toBeLessThan(0.05);
    expect(deer.doing).toBe('watch');
  });

  it('runs at top speed when run is held', () => {
    const sim = make(7, 'deer'), c = clock(sim), deer = sim.get('deer#0')!, t = sim.traits('deer');
    sim.steer(deer.id, input(Math.PI / 2, 1, true));
    c.run(3);
    expect(deer.motion.speed).toBeGreaterThan(0.8 * t.topSpeed);
    expect(deer.stamina).toBeLessThan(1);
  });

  it('a walker stays out of the water and a fish in it', () => {
    const sim = make(7, 'deer', 'trout'), c = clock(sim), deer = sim.get('deer#0')!, trout = sim.get('trout#0')!;
    const water = nearest(deer.motion, (x, z) => world.isWater(x, z));
    put(deer, nearest(water, (x, z) => !world.isWater(x, z) && Math.hypot(x - water.x, z - water.z) >= 15));
    sim.steer(deer.id, input(toward(deer, water), 1));
    let wet = 0;
    c.run(60, () => void (world.isWater(deer.motion.x, deer.motion.z) && wet++));
    expect(wet).toBe(0);
    const land = nearest(trout.motion, (x, z) => !world.isWater(x, z));
    sim.steer(trout.id, input(toward(trout, land), 1, true));
    expect(sim.steered).toBe(trout.id); // a new one replaces the deer
    let dry = 0;
    c.run(60, () => void (!world.isWater(trout.motion.x, trout.motion.z) && dry++));
    expect(dry).toBe(0);
  });

  it('stays inside the valley and finite when steered at the border for 120 s', { timeout: 30_000 }, () => {
    for (const id of ['deer#0', 'hawk#0']) {
      const sim = make(7, 'deer', 'hawk'), c = clock(sim), a = sim.get(id)!, edge = world.size / 2 - 30;
      put(a, nearest({ x: edge, z: 0 }, (x, z) => !world.isWater(x, z) && world.inside(x, z, 25)));
      sim.steer(id, input(Math.PI / 2, 1, true));
      let out = 0, bad = 0;
      c.run(120, () => {
        const m = a.motion;
        if (!world.inside(m.x, m.z)) out++;
        if (![m.x, m.z, m.yaw, m.speed, m.turnRate, m.altitude, m.speedFrac, m.climb].every(Number.isFinite)) bad++;
      });
      expect(out, id).toBe(0);
      expect(bad, id).toBe(0);
    }
  });

  it('a flier comes down and lands, and takes off again, as told', () => {
    const sim = make(7, 'hawk'), c = clock(sim), hawk = sim.get('hawk#0')!;
    expect(hawk.motion.flying).toBe(true);
    sim.steer(hawk.id, { ...input(0, 0.5), fly: -1 });
    c.run(60, undefined, () => !hawk.motion.flying);
    expect(hawk.motion.flying).toBe(false);
    expect(hawk.motion.altitude).toBe(0);
    sim.steer(hawk.id, { ...input(0, 0.5), fly: 1 });
    c.run(5);
    expect(hawk.motion.flying).toBe(true);
    expect(hawk.motion.altitude).toBeGreaterThan(3);
  });

  it('its needs keep ticking', () => {
    const sim = make(7, 'deer'), c = clock(sim), deer = sim.get('deer#0')!, was = { ...deer.needs };
    sim.steer(deer.id, input(Math.PI / 2, 1));
    c.run(60);
    expect(deer.needs.hunger).toBeGreaterThan(was.hunger);
    expect(deer.needs.thirst).toBeGreaterThan(was.thirst);
  });

  it('a steered leader does not lead', { timeout: 30_000 }, () => {
    const sim = make(7, 'deer'), c = clock(sim), herd = sim.agents.filter((a) => a.species === 'deer');
    const lead = herd.find((a) => a.leader)!, others = herd.filter((a) => a !== lead), s = sim.ctx;
    c.run(1200, undefined, () => others.filter((a) => a.doing === 'graze').length >= 4);
    const was = centre(others), start = { ...lead.motion };
    const away = nearest(start, (x, z) => Math.hypot(x - start.x, z - start.z) >= 80 && !world.isWater(x, z) && Math.hypot(x - was.x, z - was.z) >= 80);
    sim.steer(lead.id, input(toward(lead, away), 1));
    c.run(120, () => expect(lead.leader).toBe(true), () => dist(lead, start) >= 80);
    expect(dist(lead, start)).toBeGreaterThanOrEqual(80);
    // it stands there, watching: grazers feed round a leader that watches, but not round this one
    sim.steer(lead.id, input(0, 0));
    let leading = 0;
    c.run(60, () => {
      expect(lead.leader).toBe(true);
      for (const f of others) if (FEEDS.has(f.doing) && dist(lead, s.beside(f) ?? was) < 30) leading++;
    });
    expect(leading).toBe(0);
    const now = centre(others);
    expect(Math.hypot(now.x - was.x, now.z - was.z)).toBeLessThan(20);
    // handed back, it leads again: its grazers feed round it (it has strayed far from them)
    sim.steer(lead.id, null);
    expect(sim.steered).toBeNull();
    let led = 0;
    c.run(120, () => {
      for (const f of others) {
        const p = s.beside(f);
        if (FEEDS.has(f.doing) && p && dist(lead, p) < 30 && dist(f, lead.motion) > 30) led++;
      }
    }, () => led > 0);
    expect(lead.leader).toBe(true);
    expect(led).toBeGreaterThan(0);
  });

  it("a steered deer is never the herd's watcher", { timeout: 30_000 }, () => {
    const sim = make(7, 'deer'), c = clock(sim), herd = sim.agents.filter((a) => a.species === 'deer');
    c.run(1200, undefined, () => herd.filter((a) => a.doing === 'graze').length >= 4);
    const me = herd.find((a) => a.doing === 'graze' && !a.leader)!, others = herd.filter((a) => a !== me);
    sim.steer(me.id, input(0, 0));
    let unwatched = 0, grazing = 0;
    c.run(5 * ANIMAL_S_PER_HOUR, () => {
      expect(me.wary).toBe(0);
      if (others.filter((a) => a.doing === 'graze').length < 3) return;
      grazing++;
      if (!others.some((a) => a.doing === 'watch')) unwatched++;
    });
    expect(grazing).toBeGreaterThan(0);
    expect(unwatched).toBe(0);
  });

  it('a save made while steered carries on', () => {
    const sim = make(7), c = clock(sim), deer = sim.get('deer#0')!;
    sim.steer(deer.id, input(Math.PI / 2, 1));
    c.run(5);
    const back = new Sim(world, { seed: 7, species: defs, state: sim.state() }), again = back.get('deer#0')!;
    expect(DOINGS).toContain(again.doing);
    expect(back.steered).toBeNull();
    expect(JSON.stringify(sim.state())).not.toMatch(/steer/i);
    clock(back).run(60);
    expect(Number.isFinite(again.motion.x) && Number.isFinite(again.motion.z)).toBe(true);
  });

  it('hand back: it chooses for itself again', () => {
    const sim = make(7, 'deer'), c = clock(sim), deer = sim.get('deer#0')!;
    sim.steer(deer.id, input(Math.PI / 2, 1));
    c.run(5);
    sim.steer(deer.id, null);
    const at = sim.ctx.t;
    c.run(2);
    // it has started something afresh since (a steered animal never restarts), and is not heading where it was pushed
    expect(deer.since).toBeGreaterThan(at);
    const m = deer.motion, ahead = m.target && Math.hypot(m.target.x - m.x, m.target.z - m.z);
    const pushed = m.target && ahead! < 3 * sim.traits('deer').bodyLength + 0.5 && Math.abs(Math.atan2(m.target.x - m.x, m.target.z - m.z) - Math.PI / 2) < 0.1;
    expect(pushed).toBeFalsy();
  });

  it('ignores an id that is no animal', () => {
    const sim = make(7, 'deer');
    sim.steer('deer#0', input(0, 1));
    sim.steer('nobody#9', input(0, 1));
    expect(sim.steered).toBe('deer#0');
    sim.steer('nobody#9', null);
    expect(sim.steered).toBe('deer#0');
    expect(sim.ctx.steered('deer#0')).toEqual(input(0, 1));
    expect(sim.ctx.steered('deer#1')).toBeNull();
  });

  describe('Do', () => {
    /** A steered animal put at `p`, standing and watching, its Do button about to go down. */
    function ready(sim: Sim, id: string, p: Pt) {
      const c = clock(sim), a = sim.get(id)!;
      put(a, p);
      sim.steer(id, input(0, 0));
      c.run(TICK * 2);
      return c;
    }

    it("at the water's edge drinks", () => {
      const sim = make(7, 'deer'), deer = sim.get('deer#0')!;
      const c = ready(sim, deer.id, nearest(deer.motion, atBank));
      sim.setNeeds(deer.id, { thirst: 0.8 });
      sim.steer(deer.id, DO);
      c.run(TICK);
      sim.steer(deer.id, input(0, 0));
      expect(deer.doing).toBe('drink');
      expect(deer.pose.mouth).toBe('lap');
      c.run(DO_S - 1);
      expect(deer.doing).toBe('drink');
      const m = deer.motion; // facing the water: some of it lies within 2 m, within 45 degrees of where it looks
      expect(AROUND.some((r) => between(m.yaw, r) < Math.PI / 4 && world.isWater(m.x + Math.sin(r) * 2, m.z + Math.cos(r) * 2))).toBe(true);
      expect(deer.needs.thirst).toBeLessThan(0.75);
      c.run(2);
      expect(deer.doing).toBe('watch');
      expect(deer.pose.mouth).toBe('shut');
    });

    it('on grass grazes for a grazer', () => {
      const sim = make(7, 'deer'), deer = sim.get('deer#0')!;
      const c = ready(sim, deer.id, nearest(deer.motion, onMeadow, 600));
      sim.setNeeds(deer.id, { hunger: 0.8 });
      sim.steer(deer.id, DO);
      c.run(TICK);
      sim.steer(deer.id, input(0, 0));
      expect(deer.doing).toBe('graze');
      expect(deer.pose.headDown).toBe(1);
      expect(deer.pose.mouth).toBe('chew');
      c.run(DO_S - 1);
      expect(deer.needs.hunger).toBeLessThan(0.79);
      c.run(2);
      expect(deer.doing).toBe('watch');
    });

    it('elsewhere calls', () => {
      const sim = make(7, 'wolf'), wolf = sim.get('wolf#0')!;
      const c = ready(sim, wolf.id, nearest(wolf.motion, bare));
      sim.steer(wolf.id, DO);
      c.run(TICK);
      expect(wolf.doing).toBe('call');
      expect(wolf.pose.calling).toBeGreaterThan(0);
    });

    it('holds the animal in place, and a button left down does not start another', () => {
      const sim = make(7, 'wolf'), wolf = sim.get('wolf#0')!, p = nearest(wolf.motion, bare);
      const c = ready(sim, wolf.id, p);
      sim.steer(wolf.id, DO);
      c.run(DO_S - 1);
      expect(dist(wolf, p)).toBeLessThan(0.5);
      expect(wolf.doing).toBe('call');
      c.run(2);
      expect(wolf.doing).toBe('watch');
      c.run(2);
      expect(wolf.doing).toBe('watch');
    });

    it('pushing the stick ends a Do early', () => {
      const sim = make(7, 'deer'), deer = sim.get('deer#0')!;
      const c = ready(sim, deer.id, nearest(deer.motion, atBank));
      sim.steer(deer.id, DO);
      c.run(2);
      expect(deer.doing).toBe('drink');
      sim.steer(deer.id, input(0, 1));
      c.run(0.3);
      expect(deer.doing).toBe('walk');
      expect(deer.pose.mouth).toBe('shut');
    });

    it('a save made mid-Do carries on', () => {
      const sim = make(7, 'deer'), deer = sim.get('deer#0')!;
      const c = ready(sim, deer.id, nearest(deer.motion, atBank));
      sim.steer(deer.id, DO);
      c.run(2);
      expect(deer.doing).toBe('drink');
      const back = new Sim(world, { seed: 7, species: defs.filter((d) => d.id === 'deer'), state: sim.state() }), again = back.get('deer#0')!;
      clock(back).run(60);
      expect(DOINGS).toContain(again.doing);
      expect(Number.isFinite(again.motion.x) && Number.isFinite(again.motion.z)).toBe(true);
    });
  });
});

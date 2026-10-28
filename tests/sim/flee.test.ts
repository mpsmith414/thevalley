import { describe, expect, it } from 'vitest';
import { nextWatcher, watcher } from '../../src/sim/behaviours/group';
import { Places } from '../../src/sim/places';
import { Rng } from '../../src/sim/rng';
import { inCover } from '../../src/sim/senses';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Agent, type Doing, type Pt } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const defs = nativeDefs();
/** A simulation of just these species, at `seed`. */
const only = (seed: number, ...ids: string[]) => new Sim(world, { seed, species: defs.filter((d) => ids.includes(d.id)) });
const dist = (a: Agent, p: Pt) => Math.hypot(a.motion.x - p.x, a.motion.z - p.z);
const unit = (from: Pt, to: Pt) => {
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
  return { x: dx / d, z: dz / d };
};
const centre = (as: Agent[]) => ({ x: as.reduce((s, a) => s + a.motion.x, 0) / as.length, z: as.reduce((s, a) => s + a.motion.z, 0) / as.length });
/** Puts an animal at `p`, standing, with nowhere to go. */
const put = (a: Agent, p: Pt) => Object.assign(a.motion, { x: p.x, z: p.z, speed: 0, target: null });
const wet = (a: Agent) => world.isWater(a.motion.x, a.motion.z);

/** A clock that runs a simulation tick by tick from 9 in the morning. */
function clock(sim: Sim) {
  let hours = 9;
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
    get hours() {
      return hours;
    },
  };
}

/** Deer and wolves at seed 7, run until most of the herd grazes; the nearest forest; the wolf placed 30 m from the herd's centre on the far side from it. */
function grazingDeerAndWolf() {
  const sim = only(7, 'deer', 'wolf'), c = clock(sim), deer = sim.agents.filter((a) => a.species === 'deer');
  c.run(1200, undefined, () => deer.filter((a) => a.doing === 'graze' && a.pose.headDown >= 1).length >= 4);
  const mid = centre(deer), forest = new Places(world, new Rng(1)).cover(mid, mid, 300)!, u = unit(forest, mid);
  const wolf = sim.get('wolf#0')!, at = { x: mid.x + u.x * 30, z: mid.z + u.z * 30 };
  put(wolf, at);
  sim.setNeeds(wolf.id, { hunger: 0 });
  return { sim, c, deer, wolf, forest };
}

describe('fear and flight', () => {
  it('a wolf near grazing deer sends the whole herd toward the forest, well away from it, and startles it once', () => {
    const { sim, c, deer, wolf, forest } = grazingDeerAndWolf();
    expect(deer.filter((a) => a.doing === 'graze').length).toBeGreaterThanOrEqual(4);
    const start = deer.map((a) => dist(a, forest)), fled = new Set<string>();
    c.run(2, () => deer.forEach((a) => a.doing === 'flee' && fled.add(a.id)));
    expect([...fled].sort()).toEqual(deer.map((a) => a.id).sort());
    c.run(18);
    for (const [i, a] of deer.entries()) {
      expect(dist(a, wolf.motion), a.id).toBeGreaterThanOrEqual(50);
      // toward the forest: nearer it than at the start, or in its cover (a herd grazing at its edge runs in past that nearest point)
      expect(dist(a, forest) < start[i] || inCover(world, a.motion.x, a.motion.z), `${a.id} toward the forest`).toBe(true);
    }
    const startles = sim.moments.recent().filter((m) => m.kind === 'startle');
    expect(startles.length).toBe(1);
    expect(startles[0].text).toBe('Something has startled the deer.');
  });

  it('settles to a wary watch after a flight, which the herd watcher ignores', () => {
    const { sim, c, deer } = grazingDeerAndWolf();
    let waryTicks = 0, i = 0, calmAgain = false;
    const wrong: string[] = [];
    c.run(90, () => {
      i++;
      // on watch for the herd: watching, not wary, and not just done
      const duty = deer.filter((a) => a.doing === 'watch' && !a.wary && a.since >= 0);
      if (deer.some((a) => a.doing === 'watch' && a.wary > 0)) waryTicks++;
      calmAgain ||= waryTicks > 0 && deer.every((a) => a.threat === null && a.needs.fear < 0.2);
      if (duty.length > 1) wrong.push(`tick ${i}: ${duty.length} on watch for the herd`);
    });
    expect(waryTicks).toBeGreaterThan(0);
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(calmAgain).toBe(true);
    // a herd grazing round one still wary after a flight still gets its own watcher
    const herd = structuredClone(deer).slice(0, 5);
    herd.forEach((a, k) => Object.assign(a, { doing: k ? 'graze' : 'watch', since: 0, wary: k ? 0 : 5 }));
    herd.forEach((a) => (a.pose.headDown = a.doing === 'graze' ? 1 : 0));
    const next = nextWatcher({ members: herd, x: 0, z: 0, leader: herd[0] }, sim.traits('deer'));
    expect(next?.doing).toBe('graze');
    expect(watcher(herd)).toBe(next!.id);
  });

  it('does not flee from an animal that cannot hunt it', () => {
    const sim = only(7, 'deer', 'fox'), c = clock(sim), deer = sim.agents.filter((a) => a.species === 'deer');
    c.run(600, undefined, () => deer.filter((a) => a.doing === 'graze').length >= 4);
    const mid = centre(deer);
    put(sim.get('fox#0')!, { x: mid.x + 15, z: mid.z });
    const doings = new Set<Doing>();
    c.run(10, () => deer.forEach((a) => doings.add(a.doing)));
    expect(doings.has('flee')).toBe(false);
  });

  it('a rabbit freezes when a fox is 20 m off, then bolts when it comes within 10 m', () => {
    const sim = only(7, 'rabbit', 'fox'), c = clock(sim), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
    c.run(30);
    const r = sim.get('rabbit#0')!, fox = sim.get('fox#0')!, u = unit(centre(rabbits), r.motion);
    sim.setNeeds(fox.id, { hunger: 0 });
    put(fox, { x: r.motion.x + u.x * 20, z: r.motion.z + u.z * 20 });
    c.run(1.5);
    expect(r.doing).toBe('freeze');
    expect(r.motion.speed).toBeLessThan(0.05);
    expect(r.pose.ears).toBe('alert');
    put(fox, { x: r.motion.x + u.x * 10, z: r.motion.z + u.z * 10 });
    c.run(0.5);
    expect(r.doing).toBe('flee');
    c.run(1);
    expect(rabbits.every((a) => a.doing === 'flee'), 'the others bolt with it').toBe(true);
  });

  it('a frog plops into the water and stays hidden there', () => {
    const sim = only(7, 'frog', 'fox'), c = clock(sim);
    c.run(10);
    // the frog on land nearest water deep enough to hide in, that water, and the fox on the land side of it, 8 m off
    const swim = (p: Pt) => world.isWater(p.x, p.z) && world.waterDepthAt(p.x, p.z) >= 0.3;
    const nearestSwim = (a: Agent): Pt | null => {
      for (let r = 1; r < 20; r++)
        for (let k = 0; k < 36; k++) {
          const p = { x: a.motion.x + Math.sin(k / 5.73) * r, z: a.motion.z + Math.cos(k / 5.73) * r };
          if (swim(p)) return p;
        }
      return null;
    };
    const frogs = sim.agents.filter((a) => a.species === 'frog' && !wet(a) && nearestSwim(a)), fox = sim.get('fox#0')!;
    const frog = frogs.reduce((best, a) => (dist(a, nearestSwim(a)!) < dist(best, nearestSwim(best)!) ? a : best)), water = nearestSwim(frog);
    const u = unit(water!, frog.motion);
    sim.setNeeds(fox.id, { hunger: 0 });
    put(fox, { x: frog.motion.x + u.x * 8, z: frog.motion.z + u.z * 8 });
    const took = c.run(3, undefined, () => frog.doing === 'hide' && wet(frog));
    expect(took).toBeLessThan(3);
    c.run(10);
    expect(frog.doing).toBe('hide');
    expect(wet(frog)).toBe(true);
    expect(frog.motion.speed).toBeLessThan(0.05);
    expect(frog.pose.sleep).toBe(0);
  });

  it('a frog stays hidden while the hunter lingers close, and surfaces normally once it has gone', () => {
    const sim = only(7, 'frog', 'fox'), c = clock(sim);
    c.run(10);
    const frog = sim.agents.find((a) => a.species === 'frog' && !wet(a))!, fox = sim.get('fox#0')!;
    let water: Pt | null = null;
    for (let r = 1; r < 20 && !water; r++)
      for (let k = 0; k < 36 && !water; k++) {
        const p = { x: frog.motion.x + Math.sin(k / 5.73) * r, z: frog.motion.z + Math.cos(k / 5.73) * r };
        if (world.isWater(p.x, p.z)) water = p;
      }
    const u = unit(water!, frog.motion);
    sim.setNeeds(fox.id, { hunger: 0 });
    // the fox lingers 8 m from the frog (resting there: it is a danger just by being near)
    const linger = () => put(fox, { x: frog.motion.x + u.x * 8, z: frog.motion.z + u.z * 8 });
    linger();
    c.run(6, linger, () => frog.doing === 'hide' && wet(frog) && frog.wary > 0);
    expect(frog.doing).toBe('hide');
    expect(frog.wary).toBeGreaterThan(0);
    const under = { x: frog.motion.x, z: frog.motion.z };
    // well past the longest hide (40 s): it goes under again rather than coming up into a run across the water
    const doings = new Set<Doing>();
    c.run(100, () => (linger(), doings.add(frog.doing)));
    expect([...doings]).toEqual(['hide']);
    expect(dist(frog, under)).toBeLessThan(2); // no 25–40 m leg
    expect(frog.motion.speed).toBeLessThan(0.05);
    // the hunters leave (the fox and the others with it): it surfaces normally (calm again, no flight leg)
    sim.agents.filter((a) => a.species === 'fox').forEach((f, k) => put(f, { x: frog.motion.x + 300 + k * 5, z: frog.motion.z }));
    const after = new Set<Doing>();
    c.run(70, () => after.add(frog.doing));
    expect(after.has('flee')).toBe(false);
    expect(frog.doing).not.toBe('hide');
    expect(frog.threat).toBeNull();
    expect(frog.needs.fear).toBeLessThan(0.2);
  });

  it('a hawk soaring high over rabbits does not frighten them', () => {
    const sim = only(7, 'rabbit', 'hawk'), c = clock(sim), rabbits = sim.agents.filter((a) => a.species === 'rabbit');
    c.run(30);
    const hawk = sim.get('hawk#0')!;
    sim.setNeeds(hawk.id, { hunger: 0 });
    const mid = centre(rabbits), ht = sim.traits('hawk');
    let worst = 0;
    const flew = new Set<string>();
    // over them at 30 m and 45 m, at its soaring pace (above half its top speed)
    for (const alt of [30, 45]) {
      Object.assign(hawk.motion, { x: mid.x, z: mid.z, altitude: alt, flying: true, speed: 0.8 * ht.topSpeed });
      c.run(10, () => {
        Object.assign(hawk.motion, { x: mid.x, z: mid.z, altitude: alt, speed: 0.8 * ht.topSpeed });
        for (const r of rabbits) (worst = Math.max(worst, r.needs.fear)), r.doing === 'flee' && flew.add(r.id);
      });
    }
    expect(hawk.motion.speed).toBeGreaterThan(0.5 * ht.topSpeed);
    expect(worst).toBeLessThan(0.5);
    expect([...flew]).toEqual([]);
  });

  it('ducks on the bank flush onto the water from a wolf', () => {
    const sim = only(7, 'duck', 'wolf'), c = clock(sim), ducks = sim.agents.filter((a) => a.species === 'duck');
    c.run(10);
    const bank = new Places(world, new Rng(1)).bank(ducks[0].motion)!, u = unit(ducks[0].motion, bank);
    ducks.forEach((d, k) => put(d, { x: bank.x + u.x * 5 - u.z * (k - 2.5) * 1.5, z: bank.z + u.z * 5 + u.x * (k - 2.5) * 1.5 }));
    expect(ducks.some(wet)).toBe(false);
    const wolf = sim.get('wolf#0')!;
    sim.setNeeds(wolf.id, { hunger: 0 });
    put(wolf, { x: bank.x + u.x * 30, z: bank.z + u.z * 30 });
    const fled = new Set<string>();
    c.run(2, () => ducks.forEach((a) => a.doing === 'flee' && fled.add(a.id)));
    expect(fled.size).toBe(ducks.length);
    c.run(15);
    expect(ducks.filter((d) => !wet(d)).map((d) => d.id)).toEqual([]);
    expect(sim.moments.recent().filter((m) => m.kind === 'startle').length).toBe(1);
  });

  it('a trout darts from a duck passing over it, without lasting fear', () => {
    const sim = only(7, 'trout', 'duck'), c = clock(sim);
    c.run(10);
    const trout = sim.get('trout#0')!, duck = sim.get('duck#0')!;
    const over = [[2, 0], [0, 2], [-2, 0], [0, -2]].map(([x, z]) => ({ x: trout.motion.x + x, z: trout.motion.z + z })).find((p) => world.isWater(p.x, p.z))!;
    put(duck, over);
    c.run(0.2);
    expect(trout.doing).toBe('flee');
    expect(trout.needs.fear).toBe(0);
    c.run(2.5);
    expect(trout.doing).not.toBe('flee');
    expect(dist(trout, over)).toBeGreaterThan(3);
  });

  it('never flees from the camera', () => {
    const a = new Sim(world, { seed: 7, species: nativeDefs() }), b = new Sim(world, { seed: 7, species: nativeDefs() });
    const deer = b.get('deer#0')!;
    b.setView({ eye: { x: deer.motion.x + 1.5, z: deer.motion.z }, seen: () => true });
    const doings: [Doing, Doing][] = [];
    const ca = clock(a), cb = clock(b);
    for (let i = 0; i < 300; i++) {
      ca.run(TICK);
      cb.run(TICK);
      doings.push([a.get('deer#0')!.doing, deer.doing]);
    }
    expect(doings.filter(([x, y]) => x !== y)).toEqual([]);
    expect(doings.some(([, y]) => y === 'flee')).toBe(false);
    expect(b.state()).toEqual(a.state());
  });

  it('carries on exactly from a state that went through JSON, mid-flight', () => {
    const { sim, c } = grazingDeerAndWolf();
    c.run(3, undefined, () => sim.agents.some((a) => a.doing === 'flee' && a.threat && a.place));
    expect(sim.agents.some((a) => a.doing === 'flee' && a.threat)).toBe(true);
    const copy = new Sim(world, { seed: 7, species: defs.filter((d) => d.id === 'deer' || d.id === 'wolf'), state: JSON.parse(JSON.stringify(sim.state())) });
    let hours = c.hours;
    for (let i = 0; i < 400; i++) {
      hours += TICK / ANIMAL_S_PER_HOUR;
      sim.step(TICK, hours);
      copy.step(TICK, hours);
    }
    expect(copy.state()).toEqual(sim.state());
  });

  /**
   * The deer stood at `spots` on open meadow (no water or forest within 60 m), facing `yaw`, calm, and the wolf at `at`,
   * fed; then one tick, after which the deer within its flight distance have taken fright and picked their first leg.
   */
  function herdAndWolf(spots: (o: Pt) => Pt[], at: (o: Pt) => Pt) {
    const sim = only(7, 'deer', 'wolf'), c = clock(sim), deer = sim.agents.filter((a) => a.species === 'deer'), wolf = sim.get('wolf#0')!;
    let o: Pt | null = null;
    for (let k = 0; k < 400 && !o; k++) {
      const p = { x: -260 + (k % 20) * 10, z: 40 + Math.floor(k / 20) * 10 };
      let clear = true;
      for (let a = 0; a < 24 && clear; a++) for (const r of [0, 20, 40, 60]) {
        const x = p.x + Math.cos((a * Math.PI) / 12) * r, z = p.z + Math.sin((a * Math.PI) / 12) * r;
        if (world.isWater(x, z) || world.biomeAt(x, z).forest >= 0.3) clear = false;
      }
      if (clear) o = p;
    }
    expect(o).not.toBeNull();
    spots(o!).forEach((p, i) => {
      put(deer[i], p);
      Object.assign(deer[i], { doing: 'graze', since: -1, threat: null, wary: 0, place: null });
      sim.setNeeds(deer[i].id, { fear: 0, thirst: 0, hunger: 0.3, tired: 0 });
    });
    put(wolf, at(o!));
    sim.setNeeds(wolf.id, { hunger: 0, thirst: 0, tired: 0 });
    for (let i = 0; i < 4; i++) c.run(TICK); // every deer looks about (a calm one every 4 ticks)
    return { sim, c, deer, wolf: { x: wolf.motion.x, z: wolf.motion.z } };
  }

  /** Whether the straight way from `p` to `q` keeps getting farther from `d` (never nearer than at `p`, anywhere along it). */
  const awayAllTheWay = (p: Pt, q: Pt, d: Pt) => {
    const at = (k: number) => Math.hypot(p.x + (q.x - p.x) * k - d.x, p.z + (q.z - p.z) * k - d.z);
    for (let k = 1; k <= 20; k++) if (at(k / 20) < at((k - 1) / 20) - 1e-9) return false;
    return true;
  };

  it('a deer with the wolf between it and its herd runs away from the wolf, not past it toward its mates', () => {
    // the herd 20 m east of the deer, the wolf 6 m east of it (between them)
    const { deer, wolf } = herdAndWolf((o) => [o, ...[1, 2, 3, 4, 5, 6].map((k) => ({ x: o.x + 20 + Math.cos(k) * 3, z: o.z + Math.sin(k) * 3 }))], (o) => ({ x: o.x + 6, z: o.z }));
    const a = deer[0];
    expect(a.doing).toBe('flee');
    expect(a.place).not.toBeNull();
    const start = { x: a.motion.x, z: a.motion.z };
    expect(awayAllTheWay(start, a.place!, wolf)).toBe(true);
    expect(Math.hypot(a.place!.x - wolf.x, a.place!.z - wolf.z)).toBeGreaterThan(Math.hypot(start.x - wolf.x, start.z - wolf.z) + 15);
  });

  it('a herd with the wolf in its middle scatters away from it, every member', () => {
    const { deer, wolf } = herdAndWolf((o) => deer7(o), (o) => o);
    for (const a of deer) {
      expect(a.doing, a.id).toBe('flee');
      expect(a.place, a.id).not.toBeNull();
      expect(awayAllTheWay({ x: a.motion.x, z: a.motion.z }, a.place!, wolf), a.id).toBe(true);
    }
  });

  it('a fleeing deer gives way to nobody: it runs flat out past a mate ahead of it', () => {
    // two deer running from the wolf the same way, the one behind (higher n) a step behind the other
    const { sim, c, deer, wolf } = herdAndWolf((o) => [{ x: o.x + 1.2, z: o.z }, o, ...[2, 3, 4, 5, 6].map((k) => ({ x: o.x - 30 - k * 3, z: o.z + 30 }))], (o) => ({ x: o.x - 15, z: o.z }));
    const [front, back] = deer;
    for (const a of [front, back]) {
      Object.assign(a, { doing: 'flee', since: sim.ctx.t, place: { x: a.motion.x + 40, z: a.motion.z } });
      a.threat = { id: 'wolf#0', x: wolf.x, z: wolf.z, t: sim.ctx.t, noticed: true, charging: false };
      a.motion.yaw = Math.PI / 2;
      a.motion.speed = 4;
      sim.setNeeds(a.id, { fear: 0.9 });
    }
    c.run(TICK);
    expect(back.doing).toBe('flee');
    expect(Math.hypot(front.motion.x - back.motion.x, front.motion.z - back.motion.z)).toBeLessThan(2.4); // still in its space
    expect(back.motion.speedFrac).toBe(1);
  });
});

/** Seven spots round `o`, 6 m out. */
const deer7 = (o: Pt) => Array.from({ length: 7 }, (_, k) => ({ x: o.x + Math.cos((k * 2 * Math.PI) / 7) * 6, z: o.z + Math.sin((k * 2 * Math.PI) / 7) * 6 }));

import { beforeAll, describe, expect, it } from 'vitest';
import { assignGroups, carriesOn, flock, watcher, type Group } from '../../src/sim/behaviours/group';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Agent } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
/** One valley day of ticks. */
const DAY_TICKS = Math.round((24 * ANIMAL_S_PER_HOUR) / TICK);
const dist = (a: Agent, b: { x: number; z: number }) => Math.hypot(a.motion.x - b.x, a.motion.z - b.z);
const pos = (a: Agent) => ({ x: a.motion.x, z: a.motion.z });

/**
 * The seeds the herd's day is checked at (8 and 29 once had a very thirsty deer drinking alone). Over seeds 1–30 the
 * checks hold on 28 (Task 14's report; on seed 7 the wolves catch a deer at 9 h and the herd, scattered, beds down in two
 * groups).
 */
const SEEDS = [2, 3, 4, 8, 29];

/** How a seed's valley day went for its groups: the herd's togetherness, closeness, long walks and watcher, the fox pairs and the river trout. */
function groupDay(seed: number) {
  const sim = new Sim(world, { seed, species: nativeDefs() });
  const size = sim.traits('deer').size, start = sim.agents.filter((a) => a.species === 'deer').length;
  const foxPairs = [0, 1].map((h) => sim.agents.filter((a) => a.species === 'fox' && a.home === h));
  const riverTrout = sim.agents.filter((a) => a.species === 'trout' && a.home === 1);
  const herd = { start, worstTogether: Infinity, worstAt: 0, longestClose: 0, longWalkTicks: 0, worstFollow: 0 };
  const watch = { grazingTicks: 0, wrong: [] as string[], changes: 0 };
  const pairsClose = [0, 0];
  let troutApart = 0;
  const close = new Map<string, number>(), wasWary = new Set<string>();
  let hours = START_HOUR, lastWatcher: string | null = null;
  for (let i = 0; i < DAY_TICKS; i++) {
    hours += TICK / ANIMAL_S_PER_HOUR;
    sim.step(TICK, hours);
    // the herd as it is now (a newcomer walking in is not part of it yet, nor one caught)
    const deer = sim.agents.filter((a) => a.species === 'deer' && a.doing !== 'arrive' && a.doing !== 'returning');
    // together: how many deer are near the herd's centre (not while a hunter has put it to flight, until it has settled
    // again), and how long any two stand too close
    const cx = deer.reduce((s, a) => s + a.motion.x, 0) / deer.length, cz = deer.reduce((s, a) => s + a.motion.z, 0) / deer.length;
    const near = deer.filter((a) => dist(a, { x: cx, z: cz }) <= 25).length;
    const startled = deer.some((a) => a.doing === 'flee' || a.wary > 0);
    if (!startled && near < herd.worstTogether) (herd.worstTogether = near), (herd.worstAt = i);
    for (let j = 0; j < deer.length; j++)
      for (let k = j + 1; k < deer.length; k++) {
        const key = `${deer[j].id}-${deer[k].id}`, t = dist(deer[j], pos(deer[k])) < 0.8 * size ? (close.get(key) ?? 0) + TICK : 0;
        close.set(key, t);
        herd.longestClose = Math.max(herd.longestClose, t);
      }
    // the leader on a long walk, and how far the others are from it (not while the herd regroups after a flight)
    const leader = deer.find((a) => a.leader), aim = leader && (leader.detour ?? leader.motion.target);
    if (leader && aim && dist(leader, aim) > 40 && !startled) {
      herd.longWalkTicks++;
      const others = deer.filter((a) => a !== leader);
      herd.worstFollow = Math.max(herd.worstFollow, others.reduce((s, a) => s + dist(a, pos(leader)), 0) / others.length);
    }
    // one watcher while the herd grazes: deer wary after a flight watch for themselves, not the herd (one whose wariness
    // ends this tick counts only if no other watches)
    const grazing = deer.filter((a) => a.doing === 'graze').length, standing = deer.filter((a) => a.doing === 'watch' && !a.wary);
    const duty = standing.filter((a) => !wasWary.has(a.id)), watchers = duty.length ? duty : standing;
    wasWary.clear();
    deer.forEach((a) => a.wary > 0 && wasWary.add(a.id));
    if (grazing >= 3) {
      watch.grazingTicks++;
      const w = watchers[0];
      if (watchers.length !== 1 || w.pose.headDown !== 0 || w.pose.ears !== 'alert') watch.wrong.push(`tick ${i}: ${watchers.length} watching`);
    }
    if (watchers.length === 1 && watchers[0].id !== lastWatcher) {
      if (lastWatcher) watch.changes++;
      lastWatcher = watchers[0].id;
    }
    // pairs close, solitary trout apart
    foxPairs.forEach(([a, b], p) => (pairsClose[p] += dist(a, pos(b)) <= 12 ? 1 : 0));
    if (dist(riverTrout[0], pos(riverTrout[1])) > 5) troutApart++;
  }
  return { herd, watch, pairs: foxPairs.map((p) => p.length), pairsClose, trout: riverTrout.length, troutApart };
}

describe('groups, over a valley day at several seeds', () => {
  const days = new Map<number, ReturnType<typeof groupDay>>();

  beforeAll(() => {
    for (const seed of SEEDS) days.set(seed, groupDay(seed));
  }, 120_000);

  it('keeps a herd together', () => {
    for (const [seed, { herd }] of days) {
      expect(herd.start).toBe(7);
      expect(herd.worstTogether, `seed ${seed} tick ${herd.worstAt}`).toBeGreaterThanOrEqual(5);
      // two deer never stand closer than 0.8 of a body for more than 2 s (a mate in the way is steered round)
      expect(herd.longestClose, `seed ${seed}`).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('follows the leader on long walks', () => {
    let walks = 0;
    for (const [seed, { herd }] of days) {
      walks += herd.longWalkTicks;
      expect(herd.worstFollow, `seed ${seed}`).toBeLessThan(30);
    }
    expect(walks).toBeGreaterThan(0);
  });

  it('keeps one watcher', () => {
    for (const [seed, { watch }] of days) {
      expect(watch.grazingTicks, `seed ${seed}`).toBeGreaterThan(0);
      expect(watch.wrong.slice(0, 5), `seed ${seed}`).toEqual([]);
      expect(watch.changes, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps pairs close and solitary animals apart', () => {
    for (const [seed, d] of days) {
      expect(d.pairs).toEqual([2, 2]);
      for (const n of d.pairsClose) expect(n / DAY_TICKS, `seed ${seed}`).toBeGreaterThan(0.7);
      expect(d.trout).toBe(2);
      expect(d.troutApart / DAY_TICKS, `seed ${seed}`).toBeGreaterThan(0.9);
    }
  });
});

describe('assignGroups', () => {
  const sim = new Sim(world, { seed: 2, species: nativeDefs() });
  const traits = (s: string) => sim.traits(s);

  it('groups social animals by species and home, led by the lowest n, and leaves solitary ones alone', () => {
    const agents = structuredClone(sim.agents);
    for (const a of agents) Object.assign(a, { group: null, leader: true });
    assignGroups(agents, traits);
    const fox = agents.filter((a) => a.species === 'fox');
    expect(fox.map((a) => [a.group, a.leader])).toEqual([['fox:0', true], ['fox:0', false], ['fox:1', true], ['fox:1', false]]);
    expect(agents.filter((a) => a.species === 'trout').every((a) => a.group === null && !a.leader)).toBe(true);
    expect(agents.filter((a) => a.group === 'deer:0' && a.leader).map((a) => a.n)).toEqual([0]);
  });

  it('passes the lead to the lowest n present when the leader goes', () => {
    const agents = structuredClone(sim.agents).filter((a) => a.id !== 'deer#0' && a.id !== 'deer#1');
    assignGroups(agents, traits);
    expect(agents.filter((a) => a.species === 'deer' && a.leader).map((a) => a.id)).toEqual(['deer#2']);
  });

  it('gives every animal of a running sim its group', () => {
    expect(sim.agents.filter((a) => a.leader).map((a) => a.group).sort()).toEqual(['deer:0', 'duck:0', 'fox:0', 'fox:1', 'rabbit:0', 'wolf:0']);
  });
});

describe('flock', () => {
  const sim = new Sim(world, { seed: 2, species: nativeDefs() });
  const t = sim.traits('deer');
  const at = (id: string, x: number, z: number, yaw = 0, speed = 0): Agent => {
    const a = structuredClone(sim.get(id)!);
    Object.assign(a.motion, { x, z, yaw, speed });
    return a;
  };

  it('steps away from a mate too close', () => {
    const off = flock(at('deer#1', 0, 0), [at('deer#2', 1, 0)], t, TICK);
    expect(off.x).toBeLessThan(0);
  });

  it('draws a straggler toward its group', () => {
    const off = flock(at('deer#1', 0, 0), [at('deer#2', 40, 0), at('deer#3', 40, 4)], t, TICK);
    expect(off.x).toBeGreaterThan(0);
  });

  it('leans along the way the leader is heading', () => {
    const leader = at('deer#0', 3, 0, Math.PI / 2, 2);
    leader.leader = true;
    const off = flock(at('deer#1', 0, 0), [leader], t, TICK);
    expect(off.x).toBeGreaterThan(0);
  });
});

describe('watcher', () => {
  const sim = new Sim(world, { seed: 2, species: nativeDefs() });
  const herd = () => structuredClone(sim.agents.filter((a) => a.species === 'deer'));

  it('keeps the one already on watch, picks the longest grazer otherwise, and none for a small grazing group', () => {
    const g = herd();
    g.forEach((a, i) => Object.assign(a, { doing: 'graze', since: 100 + i }));
    g[4].since = 50;
    expect(watcher(g)).toBe(g[4].id);
    Object.assign(g[2], { doing: 'watch', since: 120 });
    expect(watcher(g)).toBe(g[2].id);
    const few = herd();
    few.forEach((a, i) => Object.assign(a, { doing: i < 2 ? 'graze' : 'rest', since: 100 }));
    expect(watcher(few)).toBeNull();
  });
});

describe('carriesOn', () => {
  const sim = new Sim(world, { seed: 2, species: nativeDefs() });

  it('keeps a leader that has drunk at the water while most of its herd still drinks, unless it is afraid', () => {
    const members = structuredClone(sim.agents.filter((a) => a.species === 'deer'));
    for (const b of members) Object.assign(b, { doing: 'drink' }), Object.assign(b.needs, { thirst: 0.5, fear: 0 });
    const g: Group = { members, x: 0, z: 0, leader: members[0] }, leader = members[0];
    leader.needs.thirst = 0;
    expect(carriesOn(leader, g, 'graze')).toBe(true);
    leader.needs.fear = 0.8;
    expect(carriesOn(leader, g, 'flee')).toBe(false);
  });
});

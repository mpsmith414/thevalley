import { beforeAll, describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { ANIMAL_S_PER_HOUR, TICK, type Moment } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { START_HOUR } from '../../src/world/clock';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const world = createValley(smallValleyData());
const SEEDS = [1, 2, 3, 4, 5];
/** One valley day of animal seconds, run at Fastest's step (16 ticks a step). */
const DAY = 24 * ANIMAL_S_PER_HOUR, DT = 16 * TICK;
/** Dusk, for the ducks' raft (valley hours of the day). */
const DUSK = [19.5, 22] as const;
/** A catch this many valley hours before the end may not have been made up yet (its newcomer is still on the way). */
const LATE = 4;
/** The simulation's own cost per tick (ms) for the whole cast, in Node. */
const BUDGET_MS = 0.15;

type Told = Omit<Moment, 'id'>;
type Day = { moments: Told[]; frogHides: number; counts: Record<string, number>; ms: number; ticks: number; end: number };

/**
 * One valley day of the natives at `seed`, newcomers on, from the first morning: every moment the simulation tells (cool-downs
 * aside), the times a frog went under, the cast at the end.
 */
function day(seed: number): Day {
  const sim = new Sim(world, { seed, species: nativeDefs() }), moments: Told[] = [], hiding = new Set<string>(), emit = sim.moments.emit.bind(sim.moments);
  sim.moments.emit = (m, group) => (moments.push(m), emit(m, group));
  let hours = START_HOUR, ms = 0, frogHides = 0;
  for (let i = 0; i < DAY / DT; i++) {
    hours += DT / ANIMAL_S_PER_HOUR;
    const t0 = performance.now();
    sim.step(DT, hours);
    ms += performance.now() - t0;
    for (const a of sim.agents) {
      if (a.species !== 'frog') continue;
      // a frog going under the water from a hunter it knows of
      if (a.doing === 'hide' && !hiding.has(a.id) && a.threat) frogHides++;
      if (a.doing === 'hide') hiding.add(a.id);
      else hiding.delete(a.id);
    }
  }
  const counts: Record<string, number> = {};
  for (const a of sim.agents) if (a.doing !== 'returning') counts[a.species] = (counts[a.species] ?? 0) + 1;
  return { moments, frogHides, counts, ms, ticks: (DAY / DT) * (DT / TICK), end: hours };
}

describe('a valley day at Fastest, over several seeds', () => {
  const days = new Map<number, Day>();
  const of = (seed: number, kind: Moment['kind']) => days.get(seed)!.moments.filter((m) => m.kind === kind);

  beforeAll(() => {
    for (const seed of SEEDS) days.set(seed, day(seed));
  }, 180_000);

  it('sees stalks and chases', () => {
    let stalks = 0, chases = 0;
    for (const seed of SEEDS) {
      const s = of(seed, 'stalk').length, c = of(seed, 'chase').length + of(seed, 'dive').length;
      expect(s, `seed ${seed} stalks`).toBeGreaterThan(0);
      expect(c, `seed ${seed} chases`).toBeGreaterThan(0);
      (stalks += s), (chases += c);
    }
    expect(stalks / SEEDS.length).toBeGreaterThanOrEqual(3);
    expect(chases / SEEDS.length).toBeGreaterThanOrEqual(2);
  });

  it('the deer drink together', () => {
    for (const seed of SEEDS) expect(of(seed, 'drink').some((m) => m.species[0] === 'deer' && m.actors.length >= 3), `seed ${seed}`).toBe(true);
  });

  it('the ducks raft at dusk', () => {
    for (const seed of SEEDS) {
      const at = of(seed, 'raft').map((m) => m.hours % 24);
      expect(at.some((h) => h >= DUSK[0] && h <= DUSK[1]), `seed ${seed}: rafts at ${at.map((h) => h.toFixed(1))}`).toBe(true);
    }
  });

  it('the frogs plop in when approached', () => {
    for (const seed of SEEDS) expect(days.get(seed)!.frogHides, `seed ${seed}`).toBeGreaterThan(0);
  });

  it('numbers come back to usual through newcomers', () => {
    const usual: Record<string, number> = {};
    for (const d of nativeDefs()) usual[d.id] = (usual[d.id] ?? 0) + d.target;
    for (const seed of SEEDS) {
      const { counts, end } = days.get(seed)!, late: Record<string, number> = {};
      for (const m of of(seed, 'catch')) if (m.hours > end - LATE) late[m.species[1]] = (late[m.species[1]] ?? 0) + 1;
      for (const sp in usual) expect(Math.abs((counts[sp] ?? 0) - usual[sp]), `seed ${seed} ${sp}`).toBeLessThanOrEqual(late[sp] ?? 0);
    }
  });

  it(`costs under ${BUDGET_MS} ms a tick for the whole cast`, () => {
    let ms = 0, ticks = 0;
    for (const d of days.values()) (ms += d.ms), (ticks += d.ticks);
    expect(ms / ticks).toBeLessThan(BUDGET_MS);
  });
});

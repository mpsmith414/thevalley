import { describe, expect, it } from 'vitest';
import { daylight, notices, running, runsAt } from '../../src/sim/senses';
import { Sim } from '../../src/sim/sim';
import type { Agent, Doing } from '../../src/sim/types';
import { createValley } from '../../src/valley/valley';
import { nativeDefs } from '../fixtures/sim';
import { smallValleyData } from '../fixtures/valley';

const sim = new Sim(createValley(smallValleyData()), { seed: 1, species: nativeDefs() });
const deerT = sim.traits('deer'), wolfT = sim.traits('wolf'), rabbitT = sim.traits('rabbit'), hawkT = sim.traits('hawk');

/** A copy of the first `species` standing at (x, z) facing `yaw` (0 faces +z), doing `doing`. */
function at(species: string, x: number, z: number, yaw = 0, doing: Doing = 'graze'): Agent {
  const a = structuredClone(sim.agents.find((b) => b.species === species)!);
  Object.assign(a.motion, { x, z, yaw, speed: 0 });
  a.doing = doing;
  return a;
}

describe('senses', () => {
  it('sees a wolf 50 m ahead by day, not behind it (out of its field of view)', () => {
    const wolf = at('wolf', 0, 50);
    expect(notices(at('deer', 0, 0, 0), deerT, wolf, wolfT, 1, false)).toBe(true);
    expect(notices(at('deer', 0, 0, Math.PI), deerT, wolf, wolfT, 1, false)).toBe(false);
  });

  it('hears or smells a wolf 15 m behind it, and a running one farther off', () => {
    const deer = at('deer', 0, 0, 0);
    expect(notices(deer, deerT, at('wolf', 0, -15), wolfT, 1, false)).toBe(true);
    const far = at('wolf', 0, -40);
    expect(notices(deer, deerT, far, wolfT, 1, false)).toBe(false);
    far.motion.speed = wolfT.topSpeed;
    expect(notices(deer, deerT, far, wolfT, 1, false)).toBe(true);
  });

  it('sees less far at deep night unless it sees well in the dark', () => {
    const owlish = { ...deerT, senses: { ...deerT.senses, night: 0.3 } };
    const wolf = at('wolf', 0, 50);
    expect(notices(at('deer', 0, 0), owlish, wolf, wolfT, 0, false)).toBe(false);
    expect(notices(at('deer', 0, 0), owlish, wolf, wolfT, 1, false)).toBe(true);
    expect(daylight(30)).toBe(1);
    expect(daylight(-30)).toBe(0);
  });

  it('misses a wolf stalking in cover 40 m ahead', () => {
    const sharp = { ...deerT, senses: { ...deerT.senses, acuity: 0.6 } };
    const deer = at('deer', 0, 0);
    expect(notices(deer, sharp, at('wolf', 0, 40, Math.PI, 'stalk'), wolfT, 1, true)).toBe(false);
    expect(notices(deer, sharp, at('wolf', 0, 40, Math.PI, 'stalk'), wolfT, 1, false)).toBe(true); // in the open
    expect(notices(deer, sharp, at('wolf', 0, 40, Math.PI, 'search'), wolfT, 1, true)).toBe(true); // not stalking
  });

  it('counts a flier aloft as running only when it dives, a walker whenever it is fast', () => {
    const rabbit = at('rabbit', 0, 0);
    const soaring = at('hawk', 0, 20, Math.PI, 'search');
    Object.assign(soaring.motion, { altitude: 35, flying: true, speed: 0.8 * hawkT.topSpeed });
    expect(soaring.motion.speed).toBeGreaterThan(0.5 * hawkT.topSpeed);
    expect(running(soaring, hawkT)).toBe(false);
    expect(runsAt(soaring, hawkT, rabbit)).toBe(false);
    // 20 m off and 35 m up it is heard only as an ordinary animal's footfall would be: not doubled
    expect(notices(rabbit, rabbitT, soaring, hawkT, 0, false)).toBe(false);
    // the same hawk in a dive (the seam for the stoop), or low over the ground, is running and charging
    const diving = structuredClone(soaring);
    diving.doing = 'dive';
    expect(running(diving, hawkT)).toBe(true);
    expect(runsAt(diving, hawkT, rabbit)).toBe(true);
    const low = structuredClone(soaring);
    low.motion.altitude = 1;
    expect(running(low, hawkT)).toBe(true);
    // a fast walker still runs
    const wolf = at('wolf', 0, 20, Math.PI);
    wolf.motion.speed = wolfT.topSpeed;
    expect(running(wolf, wolfT)).toBe(true);
  });
});
